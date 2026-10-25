const { AcademicSession } = require('../models');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const alerts = require('./alertService');
const audit = require('./auditService');

const ALERT_AFFECTING = ['attendanceThreshold', 'dutyLeavePolicy'];

const isPlain = v => v && typeof v === 'object' && !Array.isArray(v);

/** Applies a partial settings object field by field, so changing one key of a group never resets the others. */
function applySettings(settings, input) {
  const walk = (prefix, obj) => Object.entries(obj).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (path === 'notifications') Object.entries(value).forEach(([type, ch]) => settings.notifications.set(type, { ...(settings.notifications.get(type)?.toObject?.() || {}), ...ch }));
    else if (isPlain(value)) walk(path, value);
    else settings.set(path, value);
  });
  walk('', input);
}

async function updateSettings(actor, college, input) {
  const before = college.settings.toObject();
  applySettings(college.settings, input);
  await college.save();
  await audit.record({ actor, collegeId: college._id, action: 'settings.updated', entityType: 'College', entityId: college._id, meta: { before, after: input } });

  // A new threshold or duty leave policy changes who is short of attendance: re-evaluate everyone.
  if (ALERT_AFFECTING.some(k => input[k] !== undefined && input[k] !== before[k])) {
    await alerts.evaluateCollege(college._id);
  }
  return college.settings;
}

async function updateCollegeProfile(actor, college, input) {
  Object.assign(college, input);
  await college.save();
  await audit.record({ actor, collegeId: college._id, action: 'college.updated', entityType: 'College', entityId: college._id, meta: input });
  return college;
}

/* ---------------- academic sessions ---------------- */

const listSessions = collegeId => AcademicSession.find({ college: collegeId }).sort({ startDate: -1 }).lean();

async function createSession(actor, collegeId, input) {
  if (input.endDate <= input.startDate) throw badRequest('End date must be after the start date.', undefined, 'INVALID_RANGE');
  try {
    const session = await AcademicSession.create({ college: collegeId, name: input.name, startDate: input.startDate, endDate: input.endDate, isCurrent: false });
    if (input.isCurrent) await setCurrent(actor, collegeId, session._id);
    await audit.record({ actor, collegeId, action: 'academic_session.created', entityType: 'AcademicSession', entityId: session._id, meta: { name: session.name } });
    return AcademicSession.findById(session._id);
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('SESSION_NAME_EXISTS', 'An academic session with that name already exists.');
    throw err;
  }
}

async function setCurrent(actor, collegeId, id) {
  const target = await AcademicSession.findOne({ _id: id, college: collegeId });
  if (!target) throw notFound('Academic session not found.');
  await AcademicSession.updateMany({ college: collegeId, _id: { $ne: id }, isCurrent: true }, { $set: { isCurrent: false } });
  await AcademicSession.updateOne({ _id: id }, { $set: { isCurrent: true } });
  await audit.record({ actor, collegeId, action: 'academic_session.made_current', entityType: 'AcademicSession', entityId: id });
  return AcademicSession.findById(id);
}

const currentSession = collegeId => AcademicSession.findOne({ college: collegeId, isCurrent: true });

module.exports = { updateSettings, updateCollegeProfile, listSessions, createSession, setCurrent, currentSession };
