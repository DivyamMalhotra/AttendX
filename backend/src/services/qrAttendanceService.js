const crypto = require('crypto');
const QRCode = require('qrcode');
const { ClassSession, Attendance, StudentProfile, User } = require('../models');
const { QrSession, QrScan } = require('../models/Qr');
const { SESSION_STATUS: S, ATTENDANCE_SOURCE } = require('../config/constants');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const { todayISO } = require('../utils/dates');
const { isDuplicateKey } = require('../utils/mongoErrors');
const lifecycle = require('./sessionLifecycleService');
const live = require('./liveService');
const audit = require('./auditService');

/**
 * QR / code attendance. Honest limits: a code proves that the student could see the teacher's screen (or was told
 * the code) within the last few seconds, and the optional geofence that the phone reported a position near the
 * classroom. It cannot prove who is holding the phone, so faculty keep the final say: a scan only adds a "present"
 * record, never overwrites a record faculty already entered, and faculty submit/correct the sheet as usual.
 */
const MAX_BAD_CODES = 5;
const TOLERANCE_PERIODS = 1;

const EARTH_M = 6371000;
const rad = d => (d * Math.PI) / 180;
function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}
const round4 = n => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : null);

/** 6-digit code for a period. Deterministic from the secret, so no code is ever stored. */
const codeFor = (secret, qrId, period) => {
  const mac = crypto.createHmac('sha256', secret).update(`${qrId}:${period}`).digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
};
const periodNow = (qr, now = Date.now()) => Math.floor(now / (qr.periodSeconds * 1000));
const safeEq = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ----------------------------------------------------------------- faculty */

async function start({ actor, perms, college, classSessionId, minutes }) {
  const cfg = college.settings.qr;
  if (!cfg.enabled) throw conflict('QR_DISABLED', 'QR attendance is switched off for this college.');
  const session = await lifecycle.loadSession(college, classSessionId);
  await lifecycle.assertCanManage(actor, perms, session);
  if ([S.CANCELLED, S.COMPLETED_NO_ATTENDANCE].includes(session.status)) throw conflict('INVALID_TRANSITION', `A ${session.status} class cannot take attendance.`);

  const existing = await QrSession.findOne({ classSession: session._id, status: 'open', expiresAt: { $gt: new Date() } });
  if (existing) return describeOpen(existing);
  await QrSession.updateMany({ classSession: session._id, status: 'open' }, { $set: { status: 'closed', closedAt: new Date() } });   // an expired window

  const now = new Date();
  const geo = cfg.geofence || {};
  const useGeo = Boolean(geo.enabled && Number.isFinite(geo.lat) && Number.isFinite(geo.lng));
  let qr;
  try {
    qr = await QrSession.create({
      college: college._id, classSession: session._id, startedBy: actor._id, secret: crypto.randomBytes(32).toString('hex'),
      periodSeconds: cfg.rotateSeconds, opensAt: now, expiresAt: new Date(now.getTime() + (minutes || cfg.sessionMinutes) * 60000),
      geofence: useGeo ? { enabled: true, lat: geo.lat, lng: geo.lng, radiusMeters: geo.radiusMeters } : { enabled: false }
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    return describeOpen(await QrSession.findOne({ classSession: session._id, status: 'open' }));
  }
  if (session.status === S.SCHEDULED || session.status === S.UNMARKED) await ClassSession.updateOne({ _id: session._id, status: { $in: [S.SCHEDULED, S.UNMARKED] } }, { $set: { status: S.OPEN } });
  await audit.record({ actor, collegeId: college._id, action: 'qr.started', entityType: 'ClassSession', entityId: session._id, meta: { geofence: useGeo, minutes: Math.round((qr.expiresAt - now) / 60000) } });
  return describeOpen(qr);
}

const describeOpen = qr => ({ id: String(qr._id), classSessionId: String(qr.classSession), status: qr.status, expiresAt: qr.expiresAt, periodSeconds: qr.periodSeconds, geofence: qr.geofence.enabled, accepted: qr.accepted });

async function openWindow(college, classSessionId) {
  const qr = await QrSession.findOne({ college: college._id, classSession: classSessionId, status: 'open' }).select('+secret');
  if (!qr) throw notFound('No QR attendance window is open for this class.');
  return qr;
}

/** What the teacher's screen shows right now: the rotating code and a QR image of it. */
async function current({ actor, perms, college, classSessionId }) {
  const session = await lifecycle.loadSession(college, classSessionId);
  await lifecycle.assertCanManage(actor, perms, session);
  const qr = await openWindow(college, classSessionId);
  if (qr.expiresAt <= new Date()) throw conflict('QR_EXPIRED', 'This QR window has ended. Start a new one.');
  const period = periodNow(qr);
  const code = codeFor(qr.secret, String(qr._id), period);
  const payload = `attendx:qr:${qr._id}:${code}`;
  return {
    id: String(qr._id), code, payload, qr: await QRCode.toDataURL(payload, { margin: 1, width: 320, errorCorrectionLevel: 'M' }),
    rotatesInMs: (period + 1) * qr.periodSeconds * 1000 - Date.now(), expiresAt: qr.expiresAt, accepted: qr.accepted, geofence: qr.geofence.enabled
  };
}

async function scans({ actor, perms, college, classSessionId }) {
  const session = await lifecycle.loadSession(college, classSessionId);
  await lifecycle.assertCanManage(actor, perms, session);
  const qr = await QrSession.findOne({ college: college._id, classSession: classSessionId }).sort({ createdAt: -1 });
  if (!qr) return { window: null, accepted: [], rejected: 0 };
  const rows = await QrScan.find({ qrSession: qr._id }).populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).sort({ at: 1 }).lean();
  return {
    window: { id: String(qr._id), status: qr.status, expiresAt: qr.expiresAt, geofence: qr.geofence.enabled },
    accepted: rows.filter(r => r.outcome === 'accepted').map(r => ({ studentId: String(r.student._id), rollNo: r.student.rollNo, name: r.student.user && r.student.user.name, at: r.at, distanceMeters: r.distanceMeters })),
    rejected: rows.filter(r => r.outcome === 'rejected').length
  };
}

async function close({ actor, perms, college, classSessionId }) {
  const session = await lifecycle.loadSession(college, classSessionId);
  await lifecycle.assertCanManage(actor, perms, session);
  const qr = await QrSession.findOneAndUpdate({ college: college._id, classSession: classSessionId, status: 'open' }, { $set: { status: 'closed', closedAt: new Date(), closedBy: actor._id } }, { returnDocument: 'after' });
  if (!qr) throw notFound('No QR attendance window is open for this class.');
  await audit.record({ actor, collegeId: college._id, action: 'qr.closed', entityType: 'ClassSession', entityId: session._id, meta: { accepted: qr.accepted } });
  return describeOpen(qr);
}

/* ----------------------------------------------------------------- student */

async function reject(qr, profile, reason, extra = {}) {
  await QrScan.create({ qrSession: qr._id, college: qr.college, student: profile._id, outcome: 'rejected', reason, ...extra }).catch(() => {});
}

/**
 * A student submits the code from the QR (or types it). Nothing here trusts the client beyond the code and the
 * position it reports; the class, the enrolment, the time window and the geofence are all checked on the server.
 */
async function scan({ college, profile, sessionId, code, lat, lng, accuracy, ip }) {
  const qr = await QrSession.findOne({ _id: sessionId, college: college._id }).select('+secret');
  // the same answer for "no such window" and "not your class" so window ids cannot be probed
  const notFoundErr = () => notFound('That QR code is not valid.');
  if (!qr) throw notFoundErr();
  const session = await ClassSession.findById(qr.classSession);
  if (!session || String(session.section) !== String(profile.section)) throw notFoundErr();
  if (qr.status !== 'open' || qr.expiresAt <= new Date()) throw conflict('QR_CLOSED', 'Attendance for this class is closed.');

  const bad = await QrScan.countDocuments({ qrSession: qr._id, student: profile._id, outcome: 'rejected', reason: 'bad_code' });
  if (bad >= MAX_BAD_CODES) throw new (require('../utils/errors').AppError)(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes for this class. Ask your teacher to mark you.');
  if (await QrScan.exists({ qrSession: qr._id, student: profile._id, outcome: 'accepted' })) return { alreadyMarked: true, status: 'P' };

  const period = periodNow(qr);
  const valid = [];
  for (let p = period; p >= period - TOLERANCE_PERIODS; p -= 1) valid.push(codeFor(qr.secret, String(qr._id), p));
  const given = String(code || '').replace(/\D/g, '');
  if (!valid.some(v => safeEq(v, given.padStart(6, '0')))) {
    await reject(qr, profile, 'bad_code', { ip });
    throw badRequest('That code is not correct or has expired. Look at the screen again.', undefined, 'BAD_CODE');
  }

  let distance = null;
  if (qr.geofence.enabled) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      await reject(qr, profile, 'no_location', { ip });
      throw badRequest('Allow location access so the classroom can be verified.', undefined, 'LOCATION_REQUIRED');
    }
    if (Number.isFinite(accuracy) && accuracy > qr.geofence.radiusMeters * 2) {
      await reject(qr, profile, 'imprecise_location', { lat: round4(lat), lng: round4(lng), accuracy, ip });
      throw badRequest('Your location is too imprecise to verify. Move closer to a window or ask your teacher.', undefined, 'LOCATION_IMPRECISE');
    }
    distance = Math.round(distanceMeters({ lat, lng }, qr.geofence));
    if (distance > qr.geofence.radiusMeters) {
      await reject(qr, profile, 'outside_geofence', { lat: round4(lat), lng: round4(lng), accuracy, distanceMeters: distance, ip });
      throw forbidden('You do not appear to be in the classroom.', 'OUTSIDE_GEOFENCE');
    }
  }

  try {
    await QrScan.create({ qrSession: qr._id, college: qr.college, student: profile._id, outcome: 'accepted', distanceMeters: distance, lat: round4(lat), lng: round4(lng), accuracy: Number.isFinite(accuracy) ? accuracy : null, ip });
  } catch (err) {
    if (isDuplicateKey(err)) return { alreadyMarked: true, status: 'P' };
    throw err;
  }

  // Add a "present" record only if faculty have not already recorded this student for the class.
  const res = await Attendance.updateOne(
    { classSession: session._id, student: profile._id },
    { $setOnInsert: { college: college._id, subject: session.subject, section: session.section, date: session.date, status: 'P', source: ATTENDANCE_SOURCE.QR, markedBy: profile.user } },
    { upsert: true }
  );
  const created = res.upsertedCount > 0;
  if (created) await ClassSession.updateOne({ _id: session._id }, { $inc: { 'counts.present': 1 } });
  await QrSession.updateOne({ _id: qr._id }, { $inc: { accepted: 1 } });
  const existing = created ? null : await Attendance.findOne({ classSession: session._id, student: profile._id }).select('status').lean();
  try { await live.publish(qr.startedBy, 'qr.scan', { classSessionId: String(session._id) }); } catch (e) { /* the teacher can refresh */ }
  return { alreadyMarked: !created, status: created ? 'P' : existing.status };
}

/** Windows currently open for this student's class (so the code can also be typed in when the camera is not usable). */
async function openForStudent({ college, profile }) {
  const sessions = await ClassSession.find({ college: college._id, section: profile.section, date: todayISO(college.settings.timezone) }).populate('subject', 'name').lean();
  if (!sessions.length) return [];
  const windows = await QrSession.find({ classSession: { $in: sessions.map(s => s._id) }, status: 'open', expiresAt: { $gt: new Date() } }).lean();
  const marked = new Set((await QrScan.find({ qrSession: { $in: windows.map(w => w._id) }, student: profile._id, outcome: 'accepted' }).select('qrSession').lean()).map(m => String(m.qrSession)));
  const by = new Map(sessions.map(s => [String(s._id), s]));
  return windows.map(w => {
    const c = by.get(String(w.classSession));
    return { id: String(w._id), subject: c.subject && c.subject.name, slot: c.slot, startTime: c.startTime, endTime: c.endTime, geofence: w.geofence.enabled, expiresAt: w.expiresAt, marked: marked.has(String(w._id)) };
  });
}

module.exports = { start, current, scans, close, scan, openForStudent, distanceMeters, codeFor, periodNow };
