const { ClassSession, Attendance, StudentProfile, Subject } = require('../models');
const { ROLES, TIME_SLOTS, SESSION_STATUS } = require('../config/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { todayISO, diffDays } = require('../utils/dates');
const alerts = require('./alertService');
const audit = require('./auditService');

/**
 * Attendance is keyed by a ClassSession (subject + date + time slot) and one Attendance
 * record per student per session. Nothing here limits a subject or a student to one
 * session per day: the only uniqueness rules are (subject, date, slot) and (session, student).
 */

/** A teacher may act on a class if they teach the subject or the timetable assigned this very class to them. */
function assertCanMark(actor, subject, session = null) {
  if (actor.role === ROLES.TEACHER && String(subject.teacher) !== String(actor._id) && !(session && String(session.teacher) === String(actor._id))) {
    throw forbidden('This subject is not assigned to you.');
  }
  if (actor.role === ROLES.STUDENT) throw forbidden();
}

/** Dates must be real, not in the future, and (for faculty) inside the correction window. */
function assertDateAllowed({ actor, date, settings }) {
  const today = todayISO(settings.timezone);
  if (date > today) throw badRequest('Attendance cannot be marked for a future date.', [{ field: 'date', message: 'Date is in the future.' }], 'FUTURE_DATE');
  if (actor.role === ROLES.TEACHER && diffDays(date, today) > settings.attendanceEditWindowDays) {
    throw forbidden(`Attendance older than ${settings.attendanceEditWindowDays} days can only be changed by the administrator.`, 'EDIT_WINDOW_CLOSED');
  }
}

async function enrolledStudents(section) {
  return StudentProfile.find({ section, active: true }).select('_id user section college rollNo');
}

function validateRecords(records, enrolled) {
  const enrolledIds = new Set(enrolled.map(s => String(s._id)));
  const seen = new Set();
  for (const r of records) {
    if (!enrolledIds.has(r.studentId)) throw badRequest('Attendance includes a student who is not enrolled in this class.', [{ field: 'records', message: r.studentId }], 'STUDENT_NOT_ENROLLED');
    if (seen.has(r.studentId)) throw badRequest('A student appears more than once in the submission.', undefined, 'DUPLICATE_STUDENT');
    seen.add(r.studentId);
  }
  if (seen.size !== enrolledIds.size) {
    throw badRequest('Mark every enrolled student as present or absent before submitting.', undefined, 'INCOMPLETE_ATTENDANCE');
  }
}

/** Finds the session for (subject, date, slot) or creates it. Safe under concurrent requests. */
async function upsertSession({ subject, date, slot, actor }) {
  const filter = { subject: subject._id, date, slot };
  const attempt = () => ClassSession.findOneAndUpdate(
    filter,
    { $setOnInsert: { college: subject.college, section: subject.section, teacher: subject.teacher || actor._id, createdBy: actor._id } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true }
  );
  try {
    const res = await attempt();
    return { session: res.value, created: !res.lastErrorObject.updatedExisting };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Lost the upsert race against an identical request: the session now exists.
    const res = await attempt();
    return { session: res.value, created: false };
  }
}

async function writeRecords({ session, subject, records, date, actor }) {
  const ops = records.map(r => ({
    updateOne: {
      filter: { classSession: session._id, student: r.studentId },
      update: {
        $set: { status: r.status, date, subject: subject._id, section: subject.section, college: subject.college, updatedBy: actor._id },
        $setOnInsert: { markedBy: actor._id }
      },
      upsert: true
    }
  }));
  const run = () => Attendance.bulkWrite(ops, { ordered: false });
  try {
    return await run();
  } catch (err) {
    if (!isDuplicateKey(err) && !(err.writeErrors || []).some(e => e.code === 11000)) throw err;
    return run(); // upsert race on the same (session, student): the retry updates instead
  }
}

/**
 * Creates or corrects attendance for one class session in a single idempotent operation.
 *  expectNew: when true and the session already has attendance, refuse with SESSION_EXISTS
 *             so the UI can send the teacher to the edit screen instead of overwriting.
 */
async function submitSession({ actor, college, subjectId, date, slot, records, expectNew = false }) {
  const subject = await Subject.findOne({ _id: subjectId, college: college._id });
  if (!subject) throw notFound('Subject not found.');
  const planned = await ClassSession.findOne({ subject: subject._id, date, slot }).select('teacher status').lean();
  assertCanMark(actor, subject, planned);
  if (planned && planned.status === SESSION_STATUS.CANCELLED) throw conflict('SESSION_CANCELLED', 'This class was cancelled. Reinstate it before marking attendance.');
  // Timetable generated slots are valid even when they are not in the fixed ad hoc list.
  if (!TIME_SLOTS.includes(slot) && !planned) throw badRequest('Choose a valid time slot.', undefined, 'INVALID_SLOT');
  assertDateAllowed({ actor, date, settings: college.settings });

  const enrolled = await enrolledStudents(subject.section);
  validateRecords(records, enrolled);

  const { session, created } = await upsertSession({ subject, date, slot, actor });
  if (!created && expectNew) {
    throw conflict('SESSION_EXISTS', 'Attendance for this subject, date and time slot has already been submitted.', { sessionId: String(session._id) });
  }

  try {
    const before = created ? new Map() : new Map((await Attendance.find({ classSession: session._id }).select('student status').lean()).map(a => [String(a.student), a.status]));
    await writeRecords({ session, subject, records, date, actor });

    const present = records.filter(r => r.status === 'P').length;
    session.counts = { present, absent: records.length - present };
    session.lastEditedBy = actor._id;
    session.status = SESSION_STATUS.SUBMITTED;
    session.unmarkedAt = null;
    await session.save();

    const changes = records.filter(r => before.get(r.studentId) !== r.status).length;
    if (!created) {
      await audit.record({
        actor, collegeId: college._id, action: 'attendance.corrected', entityType: 'ClassSession', entityId: session._id,
        meta: { subject: subject.name, date, slot, changedRecords: changes }
      });
    }
    await alerts.evaluateSubject(college, subject);
    return { session, created, counts: session.counts, changedRecords: changes };
  } catch (err) {
    if (created) {
      await Attendance.deleteMany({ classSession: session._id });
      await ClassSession.deleteOne({ _id: session._id });
    }
    throw err;
  }
}

/** Edits an existing session, optionally moving it to another date/slot, and rewrites its records. */
async function updateSession({ actor, college, sessionId, date, slot, records }) {
  const session = await ClassSession.findOne({ _id: sessionId, college: college._id });
  if (!session) throw notFound('Class session not found.');
  const subject = await Subject.findById(session.subject);
  assertCanMark(actor, subject, session);
  if (session.status === SESSION_STATUS.CANCELLED) throw conflict('SESSION_CANCELLED', 'This class was cancelled.');
  if (!TIME_SLOTS.includes(slot) && !(session.source === 'timetable' && slot === session.slot)) throw badRequest('Choose a valid time slot.', undefined, 'INVALID_SLOT');
  assertDateAllowed({ actor, date: session.date, settings: college.settings });
  assertDateAllowed({ actor, date, settings: college.settings });

  const enrolled = await enrolledStudents(subject.section);
  validateRecords(records, enrolled);

  const moved = session.date !== date || session.slot !== slot;
  if (moved) {
    try {
      await ClassSession.updateOne({ _id: session._id }, { $set: { date, slot } });
    } catch (err) {
      if (isDuplicateKey(err)) throw conflict('SESSION_EXISTS', 'Another session already exists for that date and time slot.');
      throw err;
    }
    await Attendance.updateMany({ classSession: session._id }, { $set: { date } });
  }
  await writeRecords({ session, subject, records, date, actor });
  const present = records.filter(r => r.status === 'P').length;
  await ClassSession.updateOne({ _id: session._id }, { $set: { counts: { present, absent: records.length - present }, lastEditedBy: actor._id, status: SESSION_STATUS.SUBMITTED, unmarkedAt: null } });

  await audit.record({
    actor, collegeId: college._id, action: 'attendance.corrected', entityType: 'ClassSession', entityId: session._id,
    meta: { subject: subject.name, date, slot, moved }
  });
  await alerts.evaluateSubject(college, subject);
  return ClassSession.findById(session._id);
}

/** Does attendance already exist for this slot? Used by the UI before marking. */
async function lookupSession({ subjectId, date, slot }) {
  const session = await ClassSession.findOne({ subject: subjectId, date, slot }).lean();
  return session ? { exists: true, sessionId: String(session._id), counts: session.counts } : { exists: false };
}

async function getSessionDetail({ actor, college, sessionId }) {
  const session = await ClassSession.findOne({ _id: sessionId, college: college._id }).lean();
  if (!session) throw notFound('Class session not found.');
  const subject = await Subject.findById(session.subject).populate('section', 'name sem').lean();
  if (actor.role === ROLES.TEACHER && String(subject.teacher) !== String(actor._id) && String(session.teacher) !== String(actor._id)) throw forbidden();

  const [students, records] = await Promise.all([
    enrolledStudents(session.section).then(list => StudentProfile.populate(list, { path: 'user', select: 'name' })),
    Attendance.find({ classSession: session._id }).select('student status').lean()
  ]);
  const status = new Map(records.map(r => [String(r.student), r.status]));
  return {
    session: { id: String(session._id), date: session.date, slot: session.slot, counts: session.counts, status: session.status, room: session.room, startTime: session.startTime, endTime: session.endTime },
    subject: { id: String(subject._id), name: subject.name, section: subject.section },
    students: students.sort((a, b) => a.rollNo.localeCompare(b.rollNo)).map(s => ({
      id: String(s._id), rollNo: s.rollNo, name: s.user ? s.user.name : '', status: status.get(String(s._id)) || null
    }))
  };
}

/** Subjects a teacher (or, for the Administrator, the whole college) can mark, with recent sessions. */
async function listMarkableSubjects({ actor, college, sessionsPerSubject = 8 }) {
  const filter = { college: college._id };
  if (actor.role === ROLES.TEACHER) filter.teacher = actor._id;
  const subjects = await Subject.find(filter).populate('section', 'name sem').sort({ name: 1 }).lean();
  
  const today = todayISO(college.settings.timezone);

  return Promise.all(subjects.map(async s => {
    const [studentCount, sessions] = await Promise.all([
      StudentProfile.countDocuments({ section: s.section._id, active: true }),
      ClassSession.find({ subject: s._id, date: { $lte: today } }).sort({ date: -1, slot: -1 }).limit(sessionsPerSubject).lean()
    ]);
    return {
      id: String(s._id), name: s.name, code: s.code, section: s.section, studentCount,
      sessions: sessions.map(x => ({ id: String(x._id), date: x.date, slot: x.slot, counts: x.counts }))
    };
  }));
}

/** Active students enrolled in a subject's section, for the marking screen. */
async function listEnrolled(subject) {
  const students = await StudentProfile.find({ section: subject.section, active: true }).populate('user', 'name').sort({ rollNo: 1 }).lean();
  return students.map(s => ({ id: String(s._id), rollNo: s.rollNo, name: s.user ? s.user.name : '' }));
}

module.exports = { submitSession, updateSession, lookupSession, getSessionDetail, listMarkableSubjects, listEnrolled };
