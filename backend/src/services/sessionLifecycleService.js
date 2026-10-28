const { ClassSession, Subject, User, StudentProfile, Attendance } = require('../models');
const { SESSION_STATUS: S, ROLES, NOTIFICATION_TYPES } = require('../config/constants');
const { forbidden, notFound, conflict, badRequest } = require('../utils/errors');
const { toMinutes, nowIn } = require('../utils/time');
const { todayISO } = require('../utils/dates');
const notifications = require('./notificationService');
const timetable = require('./timetableService');
const audit = require('./auditService');

const OPEN_STATES = [S.SCHEDULED, S.OPEN];

async function loadSession(college, id) {
  const s = await ClassSession.findOne({ _id: id, college: college._id });
  if (!s) throw notFound('Class session not found.');
  return s;
}

/** Faculty act on their own classes; holders of attendance.approveCorrection (e.g. the HOD) on any. */
async function assertCanManage(actor, perms, session) {
  if (perms.can('attendance.approveCorrection')) return;
  const subject = await Subject.findById(session.subject).select('teacher').lean();
  const mine = String(session.teacher) === String(actor._id) || (subject && String(subject.teacher) === String(actor._id));
  if (!(actor.role === ROLES.TEACHER && mine)) throw forbidden('This class is not assigned to you.');
}

/* ------------------------------------------------------------ today's classes */

/** The signed-in faculty member's classes for a date, with everything needed to start attendance in one tap. */
async function todaysClasses({ actor, college, date, teacherId }) {
  const day = date || todayISO(college.settings.timezone);
  await timetable.generate(college._id, day, day);   // idempotent: makes sure today's sessions exist even if the job is late
  const who = teacherId || actor._id;
  const subjects = await Subject.find({ college: college._id, teacher: who }).select('_id').lean();
  const sessions = await ClassSession.find({
    college: college._id, date: day, $or: [{ teacher: who }, { subject: { $in: subjects.map(s => s._id) } }]
  }).populate('subject', 'name code').populate('section', 'name sem').sort({ startTime: 1, slot: 1 }).lean();

  const counts = await StudentProfile.aggregate([
    { $match: { section: { $in: [...new Set(sessions.map(s => s.section._id))] }, active: true } },
    { $group: { _id: '$section', n: { $sum: 1 } } }
  ]);
  const byS = new Map(counts.map(c => [String(c._id), c.n]));
  return sessions.map(s => ({
    id: String(s._id), date: s.date, slot: s.slot, startTime: s.startTime, endTime: s.endTime, room: s.room,
    subject: s.subject, section: s.section, status: s.status || (s.counts.present + s.counts.absent > 0 ? S.SUBMITTED : S.SCHEDULED),
    attendance: s.counts, studentCount: byS.get(String(s.section._id)) || 0, cancelReason: s.cancelReason,
    unmarkedAt: s.unmarkedAt, resolution: s.resolution && s.resolution.action ? s.resolution : null, source: s.source
  }));
}

/** One tap on "Start": marks the class as open for attendance. Idempotent. */
async function open({ actor, perms, college, id }) {
  const s = await loadSession(college, id);
  await assertCanManage(actor, perms, s);
  const res = await ClassSession.updateOne({ _id: s._id, status: { $in: [S.SCHEDULED, S.UNMARKED] } }, { $set: { status: S.OPEN } });
  if (!res.modifiedCount && ![S.OPEN, S.SUBMITTED].includes(s.status)) throw conflict('INVALID_TRANSITION', `A ${s.status} class cannot be opened.`);
  return ClassSession.findById(s._id);
}

async function cancel({ actor, perms, college, id, reason }) {
  const s = await loadSession(college, id);
  await assertCanManage(actor, perms, s);
  // A teacher cannot call a class off once it has begun (a 9:00-10:00 class cannot be cancelled after 9:00). From the
  // start time on, the class must be taken or closed through "explain / completed without attendance", which is audited.
  if (actor.role === ROLES.TEACHER && s.startTime) {
    const { date: today, minutes } = nowIn(college.settings.timezone);
    if (s.date < today || (s.date === today && minutes >= toMinutes(s.startTime))) {
      throw conflict('CANCEL_AFTER_START', `This class started at ${s.startTime}, so it can no longer be cancelled. Take attendance, or explain it afterwards.`);
    }
  }
  if (await Attendance.exists({ classSession: s._id })) throw conflict('HAS_ATTENDANCE', 'Attendance was already recorded for this class, so it cannot be cancelled.');
  const res = await ClassSession.updateOne({ _id: s._id, status: { $in: [...OPEN_STATES, S.UNMARKED] } }, { $set: { status: S.CANCELLED, cancelReason: reason } });
  if (!res.modifiedCount && s.status !== S.CANCELLED) throw conflict('INVALID_TRANSITION', `A ${s.status} class cannot be cancelled.`);
  await audit.record({ actor, collegeId: college._id, action: 'session.cancelled', entityType: 'ClassSession', entityId: s._id, meta: { reason } });
  return ClassSession.findById(s._id);
}

/* ------------------------------------------------------------ unmarked classes */

async function approvers(collegeId) {
  // everyone who may resolve unmarked classes: administrators plus staff whose roles include the permission
  const users = await User.find({ college: collegeId, active: true, role: ROLES.ADMIN }).select('_id customRoles departments role').lean();
  const permissionService = require('./permissionService');
  const out = [];
  for (const u of users) { if ((await permissionService.resolve({ ...u, college: collegeId })).can('attendance.approveCorrection')) out.push(u._id); }
  return out;
}

/**
 * Finds classes that took place but have no attendance: scheduled/open, already finished plus the grace
 * period, not cancelled, not in the future. Each class is flagged exactly once (atomic status change), and
 * the alert is keyed on the session, so repeated runs never duplicate notifications.
 */
async function detectUnmarked(college, now = new Date()) {
  const { date: today, minutes } = nowIn(college.settings.timezone, now);
  const grace = college.settings.unmarked.graceMinutes;
  const candidates = await ClassSession.find({
    college: college._id, status: { $in: OPEN_STATES }, source: 'timetable', endTime: { $ne: null }, date: { $lte: today }
  }).populate('subject', 'name').populate('section', 'name sem').lean();

  const flagged = [];
  for (const s of candidates) {
    const finished = s.date < today || toMinutes(s.endTime) + grace <= minutes;
    if (!finished) continue;
    const res = await ClassSession.updateOne({ _id: s._id, status: { $in: OPEN_STATES } }, { $set: { status: S.UNMARKED, unmarkedAt: now } });
    if (res.modifiedCount) flagged.push(s);
  }

  if (flagged.length && college.settings.unmarked.notifyAdmins) {
    const admins = await approvers(college._id);
    for (const s of flagged) {
      const text = `${s.subject ? s.subject.name : 'A class'} (${s.section ? s.section.name : ''}) on ${s.date}, ${s.slot} has no attendance.`;
      const targets = [...new Set([...admins.map(String), s.teacher ? String(s.teacher) : null].filter(Boolean))];
      for (const userId of targets) {
        await notifications.notify({
          collegeId: college._id, userId, type: NOTIFICATION_TYPES.UNMARKED_CLASS, title: 'Attendance not marked',
          message: text, data: { sessionId: String(s._id) }, dedupeKey: `unmarked:${s._id}`, link: 'hod.html#unmarked'
        });
      }
    }
  }
  return flagged.length;
}

const REASONS = ['explained', 'cancelled', 'completed_without_attendance'];

/** Faculty or an approver explains/closes an unmarked class. Every resolution is audited. */
async function resolve({ actor, perms, college, id, action, reason }) {
  if (!REASONS.includes(action)) throw badRequest('Choose a valid resolution.', undefined, 'INVALID_RESOLUTION');
  const s = await loadSession(college, id);
  await assertCanManage(actor, perms, s);
  if (s.status !== S.UNMARKED) throw conflict('NOT_UNMARKED', 'Only unmarked classes can be resolved.');
  const status = action === 'cancelled' ? S.CANCELLED : action === 'completed_without_attendance' ? S.COMPLETED_NO_ATTENDANCE : S.UNMARKED;
  await ClassSession.updateOne({ _id: s._id, status: S.UNMARKED }, {
    $set: { status, resolution: { action, reason, by: actor._id, at: new Date() }, ...(action === 'cancelled' ? { cancelReason: reason } : {}) }
  });
  await audit.record({ actor, collegeId: college._id, action: `session.unmarked_${action}`, entityType: 'ClassSession', entityId: s._id, meta: { reason } });
  return ClassSession.findById(s._id);
}

/** Unmarked classes for administrators (and a faculty member's own). */
async function listUnmarked({ college, teacherId, sectionIds, limit = 100 }) {
  const filter = { college: college._id, status: S.UNMARKED };
  if (teacherId) filter.teacher = teacherId;
  if (sectionIds) filter.section = { $in: sectionIds };
  return ClassSession.find(filter).populate('subject', 'name').populate('section', 'name sem').populate('teacher', 'name').sort({ date: -1 }).limit(limit).lean();
}

module.exports = { todaysClasses, open, cancel, detectUnmarked, resolve, listUnmarked, loadSession, assertCanManage };
