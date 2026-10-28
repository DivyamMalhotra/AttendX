const { Assignment, AssignmentSubmission, StudyMaterial } = require('../models/Assignment');
const { Subject, StudentProfile } = require('../models');
const { ROLES, NOTIFICATION_TYPES } = require('../config/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { describe, removeFile, resolveStored } = require('../middleware/upload');
const notifications = require('./notificationService');
const audit = require('./auditService');

/** Faculty manage coursework for subjects they teach; administrators holding everything may act on any. */
async function loadSubjectFor(actor, perms, college, subjectId) {
  const subject = await Subject.findOne({ _id: subjectId, college: college._id });
  if (!subject) throw notFound('Subject not found.');
  const mine = actor.role === ROLES.TEACHER && String(subject.teacher) === String(actor._id) && perms.can('assignments.manage');
  if (!mine && !perms.isSuper) throw forbidden('This subject is not assigned to you.');
  return subject;
}

async function loadOwned(actor, perms, college, id) {
  const a = await Assignment.findOne({ _id: id, college: college._id });
  if (!a) throw notFound('Assignment not found.');
  await loadSubjectFor(actor, perms, college, a.subject);
  return a;
}

const cleanup = files => (files || []).forEach(removeFile);

/* ------------------------------------------------------------------ faculty */

async function create({ actor, perms, college, input, files }) {
  try {
    const subject = await loadSubjectFor(actor, perms, college, input.subjectId);
    if (input.publishAt && input.deadline <= input.publishAt) throw badRequest('The deadline must be after the publication date.', undefined, 'INVALID_DEADLINE');
    const a = await Assignment.create({
      college: college._id, subject: subject._id, section: subject.section, title: input.title, instructions: input.instructions || '',
      publishAt: input.publishAt || null, deadline: input.deadline, maxMarks: input.maxMarks ?? 10,
      allowLate: Boolean(input.allowLate), allowResubmit: input.allowResubmit !== false, attachments: files.map(describe), createdBy: actor._id
    });
    await audit.record({ actor, collegeId: college._id, action: 'assignment.created', entityType: 'Assignment', entityId: a._id, meta: { title: a.title } });
    return a;
  } catch (err) { cleanup(files); throw err; }
}

async function update({ actor, perms, college, id, input }) {
  const a = await loadOwned(actor, perms, college, id);
  if (a.status === 'closed') throw conflict('ASSIGNMENT_CLOSED', 'A closed assignment cannot be edited.');
  const deadline = input.deadline || a.deadline;
  if (a.publishAt && deadline <= a.publishAt) throw badRequest('The deadline must be after the publication date.', undefined, 'INVALID_DEADLINE');
  // maximum marks must not drop below marks already given
  if (input.maxMarks !== undefined && await AssignmentSubmission.exists({ assignment: a._id, marks: { $gt: input.maxMarks } })) {
    throw conflict('MARKS_ALREADY_GIVEN', 'Some submissions already have more marks than that maximum.');
  }
  Object.assign(a, input);
  await a.save();
  await audit.record({ actor, collegeId: college._id, action: 'assignment.updated', entityType: 'Assignment', entityId: a._id, meta: input });
  return a;
}

/** Publishing makes it visible to the class and tells the students once (republish never re-notifies). */
async function publish({ actor, perms, college, id }) {
  const a = await loadOwned(actor, perms, college, id);
  if (a.status === 'closed') throw conflict('ASSIGNMENT_CLOSED', 'This assignment is closed.');
  if (a.status === 'draft') { a.status = 'published'; a.publishAt = a.publishAt && a.publishAt < new Date() ? a.publishAt : new Date(); await a.save(); }
  await announce(college, a);
  await audit.record({ actor, collegeId: college._id, action: 'assignment.published', entityType: 'Assignment', entityId: a._id });
  return a;
}

async function announce(college, a) {
  const students = await StudentProfile.find({ section: a.section, active: true }).select('user').lean();
  for (const s of students) {
    await notifications.notify({
      collegeId: college._id, userId: s.user, type: NOTIFICATION_TYPES.ASSIGNMENT, title: `New assignment: ${a.title}`,
      message: `Due ${a.deadline.toISOString().slice(0, 16).replace('T', ' ')} UTC. Open Assignments for the instructions.`,
      data: { assignmentId: String(a._id) }, dedupeKey: `assign:${a._id}:published`, link: 'student.html#assignments'
    });
  }
}

async function close({ actor, perms, college, id }) {
  const a = await loadOwned(actor, perms, college, id);
  a.status = 'closed'; await a.save();
  await audit.record({ actor, collegeId: college._id, action: 'assignment.closed', entityType: 'Assignment', entityId: a._id });
  return a;
}

async function listForFaculty({ actor, perms, college }) {
  const filter = { college: college._id };
  if (!perms.isSuper) filter.subject = { $in: (await Subject.find({ college: college._id, teacher: actor._id }).select('_id').lean()).map(s => s._id) };
  const rows = await Assignment.find(filter).populate('subject', 'name code').populate('section', 'name sem').sort({ createdAt: -1 }).limit(200).lean();
  const counts = await AssignmentSubmission.aggregate([{ $match: { assignment: { $in: rows.map(r => r._id) } } }, { $group: { _id: '$assignment', n: { $sum: 1 }, graded: { $sum: { $cond: [{ $eq: ['$status', 'graded'] }, 1, 0] } } } }]);
  const by = new Map(counts.map(c => [String(c._id), c]));
  return rows.map(r => ({ ...r, submissionCount: by.get(String(r._id))?.n || 0, gradedCount: by.get(String(r._id))?.graded || 0 }));
}

/** Everyone in the class with their submission (or none), for review and grading. */
async function submissionsFor({ actor, perms, college, id }) {
  const a = await loadOwned(actor, perms, college, id);
  const [students, subs] = await Promise.all([
    StudentProfile.find({ section: a.section, active: true }).populate('user', 'name').sort({ rollNo: 1 }).lean(),
    AssignmentSubmission.find({ assignment: a._id }).lean()
  ]);
  const by = new Map(subs.map(s => [String(s.student), s]));
  return {
    assignment: a.toObject(),
    rows: students.map(st => {
      const s = by.get(String(st._id));
      return { studentId: String(st._id), rollNo: st.rollNo, name: st.user ? st.user.name : '', submission: s ? { id: String(s._id), submittedAt: s.submittedAt, late: s.late, attempt: s.attempt, status: s.status, marks: s.marks, feedback: s.feedback, files: s.files.map(f => f.originalName), releasedAt: s.releasedAt } : null };
    })
  };
}

/** Grades one submission, or returns it for revision. Every change is kept in the submission's history. */
async function grade({ actor, perms, college, id, studentId, marks, feedback, action }) {
  const a = await loadOwned(actor, perms, college, id);
  const sub = await AssignmentSubmission.findOne({ assignment: a._id, student: studentId });
  if (!sub) throw notFound('That student has not submitted.');
  const entry = { at: new Date(), by: actor._id, action, marks: marks ?? undefined, note: feedback || '' };
  if (action === 'return') {
    await AssignmentSubmission.updateOne({ _id: sub._id }, { $set: { status: 'returned', feedback: feedback || sub.feedback, releasedAt: null }, $push: { history: entry } });
  } else {
    if (marks === undefined || marks === null || marks < 0 || marks > a.maxMarks) throw badRequest(`Marks must be between 0 and ${a.maxMarks}.`, undefined, 'INVALID_MARKS');
    await AssignmentSubmission.updateOne({ _id: sub._id }, {
      $set: { status: 'graded', marks, feedback: feedback || '', gradedBy: actor._id, gradedAt: new Date() }, $push: { history: entry }
    });
  }
  await audit.record({ actor, collegeId: college._id, action: action === 'return' ? 'submission.returned' : 'submission.graded', entityType: 'AssignmentSubmission', entityId: sub._id, meta: { marks, previousMarks: sub.marks } });
  return AssignmentSubmission.findById(sub._id);
}

/** Makes graded marks and feedback visible to the students (once; students are told). */
async function release({ actor, perms, college, id }) {
  const a = await loadOwned(actor, perms, college, id);
  const pending = await AssignmentSubmission.find({ assignment: a._id, status: 'graded', releasedAt: null }).lean();
  if (!pending.length) return { released: 0 };
  await AssignmentSubmission.updateMany({ _id: { $in: pending.map(p => p._id) } }, { $set: { releasedAt: new Date() } });
  const profiles = await StudentProfile.find({ _id: { $in: pending.map(p => p.student) } }).select('user').lean();
  const byStudent = new Map(pending.map(x => [String(x.student), x]));
  for (const p of profiles) {
    const sub = byStudent.get(String(p._id));
    await notifications.notify({
      collegeId: college._id, userId: p.user, type: NOTIFICATION_TYPES.ASSIGNMENT, title: `Assignment graded: ${a.title}`,
      message: 'Your marks and feedback are available.', data: { assignmentId: String(a._id) },
      // one notice per grading decision (the history grows with every grade/return, so a re-grade notifies again)
      dedupeKey: `assign:${a._id}:graded:${sub._id}:${sub.history.length}`, link: 'student.html#assignments'
    });
  }
  await audit.record({ actor, collegeId: college._id, action: 'assignment.grades_released', entityType: 'Assignment', entityId: a._id, meta: { released: pending.length } });
  return { released: pending.length };
}

/* ----------------------------------------------------------------- students */

// students keep seeing closed assignments (read-only), never drafts
const visibleNow = () => ({ status: { $in: ['published', 'closed'] }, $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] });

async function listForStudent({ college, profile }) {
  const rows = await Assignment.find({ college: college._id, section: profile.section, ...visibleNow() }).populate('subject', 'name code').sort({ deadline: 1 }).lean();
  const subs = await AssignmentSubmission.find({ student: profile._id, assignment: { $in: rows.map(r => r._id) } }).lean();
  const by = new Map(subs.map(s => [String(s.assignment), s]));
  const now = Date.now();
  return rows.map(a => {
    const s = by.get(String(a._id));
    const released = s && s.releasedAt;
    return {
      id: String(a._id), title: a.title, instructions: a.instructions, subject: a.subject, deadline: a.deadline, maxMarks: a.maxMarks,
      allowLate: a.allowLate, allowResubmit: a.allowResubmit, attachments: a.attachments.map((f, i) => ({ index: i, name: f.originalName, size: f.size })),
      overdue: !s && new Date(a.deadline).getTime() < now, closed: a.status === 'closed',
      submission: s ? {
        submittedAt: s.submittedAt, late: s.late, attempt: s.attempt, files: s.files.map((f, i) => ({ index: i, name: f.originalName })),
        status: released || s.status === 'returned' ? s.status : 'submitted',          // grading stays hidden until released
        marks: released ? s.marks : null, feedback: released || s.status === 'returned' ? s.feedback : ''
      } : null
    };
  });
}

/** Submit or resubmit. The deadline, late policy and resubmission policy are enforced on the server clock. */
async function submit({ college, profile, user, assignmentId, files, note }) {
  try {
    if (!files.length) throw badRequest('Attach at least one file.', undefined, 'FILE_REQUIRED');
    const a = await Assignment.findOne({ _id: assignmentId, college: college._id, section: profile.section, ...visibleNow() });
    if (!a) throw notFound('Assignment not found.');
    if (a.status === 'closed') throw conflict('ASSIGNMENT_CLOSED', 'This assignment is closed.');
    const now = new Date();
    const late = now > a.deadline;
    if (late && !a.allowLate) throw conflict('DEADLINE_PASSED', 'The deadline has passed and late submissions are not accepted.');

    const existing = await AssignmentSubmission.findOne({ assignment: a._id, student: profile._id });
    if (existing) {
      const mayRedo = existing.status === 'returned' || (a.allowResubmit && existing.status === 'submitted');
      if (!mayRedo) throw conflict('RESUBMIT_NOT_ALLOWED', existing.status === 'graded' ? 'This work has been graded and cannot be resubmitted.' : 'Resubmission is not allowed for this assignment.');
      const old = existing.files;
      // atomic: only replace while the status is still the one we checked
      const res = await AssignmentSubmission.updateOne({ _id: existing._id, status: existing.status }, {
        $set: { files: files.map(describe), note: note || '', submittedAt: now, late, status: 'submitted', marks: null, releasedAt: null },
        $inc: { attempt: 1 }, $push: { history: { at: now, by: user._id, action: 'resubmitted', note: `${files.length} file(s)` } }
      });
      if (!res.modifiedCount) throw conflict('RESUBMIT_NOT_ALLOWED', 'The submission changed; reload and try again.');
      old.forEach(f => { try { require('fs').unlink(resolveStored('submissions', f.storedName), () => {}); } catch (e) { /* already gone */ } });
      return AssignmentSubmission.findById(existing._id);
    }
    return await AssignmentSubmission.create({
      college: college._id, assignment: a._id, student: profile._id, files: files.map(describe), note: note || '', submittedAt: now, late,
      history: [{ at: now, by: user._id, action: 'submitted', note: `${files.length} file(s)` }]
    });
  } catch (err) { cleanup(files); throw err; }
}

/* ---------------------------------------------------------------- materials */

async function addMaterial({ actor, perms, college, input, file }) {
  try {
    const subject = await loadSubjectFor(actor, perms, college, input.subjectId);
    if (!file) throw badRequest('Attach the file.', undefined, 'FILE_REQUIRED');
    const m = await StudyMaterial.create({
      college: college._id, subject: subject._id, section: subject.section, title: input.title, topic: input.topic || '',
      resourceType: input.resourceType || 'lecture_notes', file: describe(file), createdBy: actor._id
    });
    await audit.record({ actor, collegeId: college._id, action: 'material.added', entityType: 'StudyMaterial', entityId: m._id, meta: { title: m.title } });
    return m;
  } catch (err) { cleanup(file ? [file] : []); throw err; }
}

async function removeMaterial({ actor, perms, college, id }) {
  const m = await StudyMaterial.findOne({ _id: id, college: college._id });
  if (!m) throw notFound('Material not found.');
  await loadSubjectFor(actor, perms, college, m.subject);
  await m.deleteOne();
  require('fs').unlink(resolveStored('materials', m.file.storedName), () => {});
  await audit.record({ actor, collegeId: college._id, action: 'material.removed', entityType: 'StudyMaterial', entityId: id });
}

async function listMaterials({ college, filter }) {
  return StudyMaterial.find({ college: college._id, ...filter }).populate('subject', 'name code').sort({ createdAt: -1 }).limit(300).lean();
}

/* -------------------------------------------------------------- file access */

/**
 * Resolves who may download which stored file. Private student work is only ever served through here.
 *  assignment attachment : students of the section (once published), the subject's teacher, super administrators
 *  submission file       : the owning student, the subject's teacher, super administrators
 *  study material        : students of the section, the subject's teacher, super administrators
 */
async function fileFor({ actor, perms, college, kind, id, index = 0, profile }) {
  const teacherOrAdmin = async subjectId => {
    if (perms && perms.isSuper) return true;
    const s = await Subject.findOne({ _id: subjectId, college: college._id }).select('teacher').lean();
    return Boolean(s && actor.role === ROLES.TEACHER && String(s.teacher) === String(actor._id));
  };
  if (kind === 'material') {
    const m = await StudyMaterial.findOne({ _id: id, college: college._id }).lean();
    if (!m) throw notFound('File not found.');
    if (!(profile ? String(profile.section) === String(m.section) : await teacherOrAdmin(m.subject))) throw forbidden();
    return { dir: 'materials', meta: m.file, name: m.title };
  }
  if (kind === 'assignment') {
    const a = await Assignment.findOne({ _id: id, college: college._id }).lean();
    if (!a || !a.attachments[index]) throw notFound('File not found.');
    const ok = profile ? String(profile.section) === String(a.section) && a.status !== 'draft' : await teacherOrAdmin(a.subject);
    if (!ok) throw forbidden();
    return { dir: 'assignments', meta: a.attachments[index], name: a.title };
  }
  const s = await AssignmentSubmission.findOne({ _id: id, college: college._id }).lean();
  if (!s || !s.files[index]) throw notFound('File not found.');
  const a = await Assignment.findById(s.assignment).select('subject title').lean();
  const ok = profile ? String(profile._id) === String(s.student) : await teacherOrAdmin(a.subject);
  if (!ok) throw forbidden();
  return { dir: 'submissions', meta: s.files[index], name: `submission-${a.title}` };
}

/** Reminder for students who have not submitted work due within `hours` (idempotent per student/assignment). */
async function remindDueSoon(college, hours = 24, now = new Date()) {
  const until = new Date(now.getTime() + hours * 3600000);
  const due = await Assignment.find({ college: college._id, ...visibleNow(), status: 'published', deadline: { $gt: now, $lte: until } }).lean();
  let sent = 0;
  for (const a of due) {
    const done = new Set((await AssignmentSubmission.find({ assignment: a._id }).select('student').lean()).map(s => String(s.student)));
    const students = await StudentProfile.find({ section: a.section, active: true }).select('user').lean();
    for (const s of students) {
      if (done.has(String(s._id))) continue;
      const n = await notifications.notify({
        collegeId: college._id, userId: s.user, type: NOTIFICATION_TYPES.ASSIGNMENT, title: `Assignment due soon: ${a.title}`,
        message: 'The deadline is within 24 hours and no submission has been received.', data: { assignmentId: String(a._id) },
        dedupeKey: `assign:${a._id}:due:${s._id}`, link: 'student.html#assignments'
      });
      if (n) sent += 1;
    }
  }
  return sent;
}

module.exports = {
  create, update, publish, close, listForFaculty, submissionsFor, grade, release, listForStudent, submit,
  addMaterial, removeMaterial, listMaterials, fileFor, remindDueSoon
};
