const { MentorAssignment, MentorNote, StudentProfile, User } = require('../models');
const { ROLES, NOTIFICATION_TYPES } = require('../config/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { todayISO } = require('../utils/dates');
const snapshot = require('./studentSnapshotService');
const notifications = require('./notificationService');
const audit = require('./auditService');

/* --------------------------------------------------------------- assignment */

/**
 * Assigns (or reassigns) a mentor to students. The previous assignment is ended, never overwritten, so the
 * history stays; the unique "one active mentor per student" index backs this up under concurrency.
 */
async function assign({ actor, college, studentIds, mentorId, sessionId, reason }) {
  const mentor = await User.findOne({ _id: mentorId, college: college._id, active: true, role: { $in: [ROLES.TEACHER, ROLES.STAFF] } });
  if (!mentor) throw badRequest('Choose an active faculty or staff member as the mentor.', undefined, 'MENTOR_NOT_FOUND');
  const students = await StudentProfile.find({ _id: { $in: studentIds }, college: college._id, active: true }).select('_id user').lean();
  if (students.length !== new Set(studentIds.map(String)).size) throw badRequest('One or more students were not found.', undefined, 'STUDENT_NOT_FOUND');

  const now = new Date();
  let assigned = 0; let unchanged = 0;
  for (const s of students) {
    const current = await MentorAssignment.findOne({ student: s._id, to: null });
    if (current && String(current.mentor) === String(mentor._id)) { unchanged += 1; continue; }
    if (current) await MentorAssignment.updateOne({ _id: current._id, to: null }, { $set: { to: now } });
    try {
      await MentorAssignment.create({ college: college._id, student: s._id, mentor: mentor._id, academicSession: sessionId || null, from: now, reason: reason || '', createdBy: actor._id });
      assigned += 1;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      throw conflict('MENTOR_RACE', 'Another assignment for this student was made at the same time. Reload and retry.');
    }
    await notifications.notify({
      collegeId: college._id, userId: s.user, type: NOTIFICATION_TYPES.MENTOR, title: 'Mentor assigned',
      message: `${mentor.name} is now your mentor.`, data: { mentorId: String(mentor._id) }, dedupeKey: `mentor:${s._id}:${mentor._id}:${now.getTime()}`
    });
  }
  await audit.record({ actor, collegeId: college._id, action: 'mentor.assigned', entityType: 'User', entityId: mentor._id, meta: { students: assigned, unchanged, reason } });
  return { assigned, unchanged };
}

async function listAssignments({ collegeId, mentorId }) {
  const filter = { college: collegeId, to: null, ...(mentorId ? { mentor: mentorId } : {}) };
  return MentorAssignment.find(filter).populate('mentor', 'name email')
    .populate({ path: 'student', select: 'rollNo user section', populate: [{ path: 'user', select: 'name' }, { path: 'section', select: 'name sem' }] })
    .sort({ from: -1 }).limit(500).lean();
}

const history = studentId => MentorAssignment.find({ student: studentId }).populate('mentor', 'name').sort({ from: -1 }).lean();

async function isMentorOf(userId, studentId) {
  return Boolean(await MentorAssignment.exists({ student: studentId, mentor: userId, to: null }));
}

/** Mentors only reach students assigned to them; other roles need the explicit timeline permission. */
async function assertAccess({ actor, perms, college, studentId }) {
  const profile = await StudentProfile.findOne({ _id: studentId, college: college._id });
  if (!profile) throw notFound('Student not found.');
  if (await isMentorOf(actor._id, profile._id)) return profile;
  if (perms.can('timeline.view')) {
    const { allowedSectionIds } = require('./permissionService');
    const ids = await allowedSectionIds({ college, perms }, 'timeline.view');
    if (!ids || ids.some(s => String(s) === String(profile.section))) return profile;
  }
  throw forbidden('This student is not assigned to you.', 'NOT_MENTOR');
}

/** The academic overview a mentor sees: attendance, leave (never medical), fee status, results, coursework. */
async function overview({ actor, perms, college, studentId }) {
  const profile = await assertAccess({ actor, perms, college, studentId });
  const [identity, attendance, leave, fees, results, assignments] = await Promise.all([
    snapshot.identity(profile), snapshot.attendance(college, profile), snapshot.leave(college, profile),
    snapshot.fees(college, profile), snapshot.results(profile), snapshot.assignments(college, profile)
  ]);
  return { student: identity, attendance, leave, fees: { totals: fees.totals, items: fees.items.map(({ label, status, overdue, outstandingPaise }) => ({ label, status, overdue, outstandingPaise })) }, results, assignments };
}

/* -------------------------------------------------------------------- notes */

/** Counselling notes: the author reads their own; only explicit mentorNotes.view holders read others'. */
async function addNote({ actor, perms, college, studentId, input }) {
  if (!(await isMentorOf(actor._id, studentId)) && !perms.can('mentorNotes.view')) throw forbidden('Only the assigned mentor can add notes.', 'NOT_MENTOR');
  const profile = await StudentProfile.findOne({ _id: studentId, college: college._id }).select('_id').lean();
  if (!profile) throw notFound('Student not found.');
  const note = await MentorNote.create({
    college: college._id, student: profile._id, author: actor._id, noteDate: input.noteDate || todayISO(college.settings.timezone),
    category: input.category || 'academic', content: input.content, context: input.context || '',
    followUp: { action: input.followUpAction || '', dueDate: input.followUpDate || null, done: false }
  });
  await audit.record({ actor, collegeId: college._id, action: 'mentornote.created', entityType: 'MentorNote', entityId: note._id, meta: { student: String(profile._id), category: note.category } });
  return note;
}

async function listNotes({ actor, perms, college, studentId }) {
  const all = perms.can('mentorNotes.view');
  const filter = { college: college._id, student: studentId, ...(all ? {} : { author: actor._id }) };
  if (!all && !(await isMentorOf(actor._id, studentId)) && !(await MentorNote.exists(filter))) throw forbidden('You cannot read counselling notes for this student.', 'NOT_MENTOR');
  const rows = await MentorNote.find(filter).populate('author', 'name').sort({ noteDate: -1, createdAt: -1 }).lean();
  if (rows.some(r => String(r.author._id) !== String(actor._id))) {
    await audit.record({ actor, collegeId: college._id, action: 'mentornote.accessed', entityType: 'StudentProfile', entityId: studentId, meta: { count: rows.length } });
  }
  return rows;
}

async function updateNote({ actor, college, id, input }) {
  const note = await MentorNote.findOne({ _id: id, college: college._id });
  if (!note) throw notFound('Note not found.');
  if (String(note.author) !== String(actor._id)) throw forbidden('Only the author can change a note.');
  if (input.content !== undefined) note.content = input.content;
  if (input.category) note.category = input.category;
  if (input.followUpAction !== undefined) note.followUp.action = input.followUpAction;
  if (input.followUpDate !== undefined) note.followUp.dueDate = input.followUpDate;
  if (input.followUpDone !== undefined) { note.followUp.done = input.followUpDone; note.followUp.doneAt = input.followUpDone ? new Date() : undefined; }
  await note.save();
  await audit.record({ actor, collegeId: college._id, action: 'mentornote.updated', entityType: 'MentorNote', entityId: id });
  return note;
}

/** Open follow-ups of the mentor's own notes (no note content is exposed outside the notes screen). */
async function followUps({ actor, college }) {
  const rows = await MentorNote.find({ college: college._id, author: actor._id, 'followUp.action': { $ne: '' }, 'followUp.done': false })
    .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).sort({ 'followUp.dueDate': 1 }).limit(100).lean();
  return rows.map(r => ({ noteId: String(r._id), student: { id: String(r.student._id), rollNo: r.student.rollNo, name: r.student.user && r.student.user.name }, action: r.followUp.action, dueDate: r.followUp.dueDate }));
}

module.exports = { assign, listAssignments, history, isMentorOf, assertAccess, overview, addNote, listNotes, updateNote, followUps };
