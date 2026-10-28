const { Exam, MarksEntry, GradingPolicy } = require('../models');
const { Section, Subject, StudentProfile, AcademicSession, User } = require('../models');
const { EXAM_STATUS: X, ROLES, NOTIFICATION_TYPES } = require('../config/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { isHHMM, toMinutes, overlaps } = require('../utils/time');
const { todayISO } = require('../utils/dates');
const { gradeResult, validateBands } = require('../utils/grading');
const notifications = require('./notificationService');
const audit = require('./auditService');

/* ----------------------------------------------------------- grading policy */

const getPolicy = collegeId => GradingPolicy.findOne({ college: collegeId, active: true }).lean();

/** Defines or replaces the college's grading scale. Published results keep the grades frozen at publication. */
async function savePolicy(actor, collegeId, input) {
  const problem = validateBands(input.bands);
  if (problem) throw badRequest(problem, undefined, 'INVALID_GRADING_POLICY');
  const existing = await GradingPolicy.findOne({ college: collegeId, active: true });
  let policy;
  if (existing) {
    existing.set({ name: input.name, bands: input.bands, absentGrade: input.absentGrade || existing.absentGrade, version: existing.version + 1, updatedBy: actor._id });
    policy = await existing.save();
  } else {
    policy = await GradingPolicy.create({ college: collegeId, name: input.name, bands: input.bands, absentGrade: input.absentGrade || 'AB', updatedBy: actor._id });
  }
  await audit.record({ actor, collegeId, action: 'grading_policy.saved', entityType: 'GradingPolicy', entityId: policy._id, meta: { version: policy.version, bands: input.bands.length } });
  return policy;
}

/* ----------------------------------------------------------------- exams */

async function loadExam(collegeId, id) {
  const exam = await Exam.findOne({ _id: id, college: collegeId });
  if (!exam) throw notFound('Examination not found.');
  return exam;
}

async function assertScope(exam, allowedSectionIds) {
  if (allowedSectionIds && !allowedSectionIds.some(s => String(s) === String(exam.section))) throw forbidden('That examination is outside your department.', 'OUT_OF_SCOPE');
}

async function findClash(collegeId, exam, excludeId) {
  if (!exam.startTime || !exam.endTime) return null;
  const same = await Exam.find({ college: collegeId, date: exam.date, _id: { $ne: excludeId }, startTime: { $ne: null } }).lean();
  return same.find(o => overlaps(exam.startTime, exam.endTime, o.startTime, o.endTime)
    && (String(o.section) === String(exam.section) || (exam.venue && o.venue && o.venue.toLowerCase() === exam.venue.toLowerCase()))) || null;
}

function validateInput(input) {
  if ((input.startTime || input.endTime) && !(isHHMM(input.startTime) && isHHMM(input.endTime) && toMinutes(input.startTime) < toMinutes(input.endTime))) {
    throw badRequest('End time must be after the start time.', undefined, 'INVALID_TIME');
  }
  if (input.passMarks > input.maxMarks) throw badRequest('Passing marks cannot exceed the maximum marks.', undefined, 'INVALID_MARKS');
  if (input.components && input.components.length) {
    const sum = input.components.reduce((t, c) => t + c.maxMarks, 0);
    if (Math.abs(sum - input.maxMarks) > 1e-9) throw badRequest('Assessment components must add up to the maximum marks.', undefined, 'COMPONENTS_MISMATCH');
  }
}

async function create(actor, college, allowedSectionIds, input) {
  validateInput(input);
  const subject = await Subject.findOne({ _id: input.subjectId, college: college._id });
  if (!subject) throw badRequest('Subject not found.', undefined, 'SUBJECT_NOT_FOUND');
  const section = await Section.findOne({ _id: subject.section, college: college._id });
  if (allowedSectionIds && !allowedSectionIds.some(s => String(s) === String(section._id))) throw forbidden('That subject is outside your department.', 'OUT_OF_SCOPE');
  if (!(await AcademicSession.exists({ _id: input.academicSessionId, college: college._id }))) throw badRequest('Academic session not found.', undefined, 'SESSION_NOT_FOUND');

  const doc = {
    college: college._id, name: input.name, type: input.type || 'internal', academicSession: input.academicSessionId,
    semesterNumber: input.semesterNumber || section.semesterNumber, section: section._id, subject: subject._id, date: input.date,
    startTime: input.startTime || null, endTime: input.endTime || null, venue: input.venue || '', maxMarks: input.maxMarks, passMarks: input.passMarks,
    components: input.components || [], countsForGpa: input.countsForGpa !== false, createdBy: actor._id
  };
  const clash = await findClash(college._id, doc, null);
  if (clash) throw conflict('EXAM_CONFLICT', 'Another examination for this class or venue overlaps in time.', { examId: String(clash._id) });
  try {
    const exam = await Exam.create(doc);
    await audit.record({ actor, collegeId: college._id, action: 'exam.created', entityType: 'Exam', entityId: exam._id, meta: { name: exam.name, date: exam.date } });
    await announceSchedule(college, exam, subject);
    return exam;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('EXAM_EXISTS', 'An examination with that name already exists for this subject and session.');
    throw err;
  }
}

async function announceSchedule(college, exam, subject) {
  const students = await StudentProfile.find({ section: exam.section, active: true }).select('user').lean();
  for (const s of students) {
    await notifications.notify({
      collegeId: college._id, userId: s.user, type: NOTIFICATION_TYPES.EXAM, title: `Examination scheduled: ${subject.name}`,
      message: `${exam.name} is on ${exam.date}${exam.startTime ? ` at ${exam.startTime}` : ''}${exam.venue ? `, ${exam.venue}` : ''}. Maximum marks ${exam.maxMarks}.`,
      data: { examId: String(exam._id) }, dedupeKey: `exam:${exam._id}:scheduled`, link: 'student.html#results'
    });
  }
}

async function update(actor, college, allowedSectionIds, id, input) {
  const exam = await loadExam(college._id, id);
  await assertScope(exam, allowedSectionIds);
  if (exam.status !== X.DRAFT) throw conflict('EXAM_LOCKED', 'Only examinations that are still in draft can be edited.');
  const next = { ...exam.toObject(), ...input };
  validateInput(next);
  const clash = await findClash(college._id, next, exam._id);
  if (clash) throw conflict('EXAM_CONFLICT', 'Another examination for this class or venue overlaps in time.');
  Object.assign(exam, input);
  await exam.save();
  await audit.record({ actor, collegeId: college._id, action: 'exam.updated', entityType: 'Exam', entityId: id, meta: input });
  return exam;
}

async function remove(actor, college, allowedSectionIds, id) {
  const exam = await loadExam(college._id, id);
  await assertScope(exam, allowedSectionIds);
  if (exam.status !== X.DRAFT || await MarksEntry.exists({ exam: exam._id })) throw conflict('EXAM_LOCKED', 'Only a draft examination without marks can be deleted.');
  await exam.deleteOne();
  await audit.record({ actor, collegeId: college._id, action: 'exam.deleted', entityType: 'Exam', entityId: id });
}

async function list(collegeId, { sectionIds, status, teacherId, sessionId, semesterNumber } = {}) {
  const filter = { college: collegeId };
  if (sectionIds) filter.section = { $in: sectionIds };
  if (status) filter.status = status;
  if (sessionId) filter.academicSession = sessionId;
  if (semesterNumber) filter.semesterNumber = semesterNumber;
  if (teacherId) filter.subject = { $in: (await Subject.find({ college: collegeId, teacher: teacherId }).select('_id').lean()).map(s => s._id) };
  return Exam.find(filter).populate('subject', 'name code credits').populate('section', 'name sem').populate('academicSession', 'name').sort({ date: -1 }).limit(300).lean();
}

/* ----------------------------------------------------------------- marks */

async function assertCanEnter(actor, perms, exam) {
  // Exam Cell (and the Administrator) upload marks for any examination; teachers only for their own subjects.
  if (perms.can('marks.upload')) return;
  if (!perms.can('marks.enter')) throw forbidden();
  const subject = await Subject.findById(exam.subject).select('teacher').lean();
  if (actor.role !== ROLES.TEACHER || String(subject.teacher) !== String(actor._id)) throw forbidden('This examination is not assigned to you.');
}

async function marksSheet({ actor, perms, college, id }) {
  const exam = await loadExam(college._id, id);
  const subject = await Subject.findById(exam.subject).select('teacher name credits').lean();
  const mine = actor.role === ROLES.TEACHER && String(subject.teacher) === String(actor._id) && perms.can('marks.enter');
  if (!mine && !perms.canAny(['marks.review', 'results.view', 'exams.configure', 'results.publish'])) throw forbidden();
  const [students, entries] = await Promise.all([
    StudentProfile.find({ section: exam.section, active: true }).populate('user', 'name').sort({ rollNo: 1 }).lean(),
    MarksEntry.find({ exam: exam._id }).lean()
  ]);
  const by = new Map(entries.map(e => [String(e.student), e]));
  return {
    exam: { id: String(exam._id), name: exam.name, status: exam.status, maxMarks: exam.maxMarks, passMarks: exam.passMarks, date: exam.date, revision: exam.revision, subject: subject.name, credits: subject.credits },
    editable: mine && [X.DRAFT, X.MARKS_ENTRY].includes(exam.status),
    students: students.map(s => {
      const e = by.get(String(s._id));
      return { id: String(s._id), rollNo: s.rollNo, name: s.user ? s.user.name : '', marks: e ? e.marks : null, absent: e ? e.absent : false, remark: e ? e.remark : '' };
    })
  };
}

/**
 * Saves (draft) marks. All-or-nothing: if any row is invalid nothing is written. Every change is kept in
 * the row's history with who/when/why. After a reopen (revision > 1) a reason is mandatory.
 */
async function saveMarks({ actor, perms, college, id, entries, reason }) {
  const exam = await loadExam(college._id, id);
  await assertCanEnter(actor, perms, exam);
  if (![X.DRAFT, X.MARKS_ENTRY].includes(exam.status)) throw conflict('MARKS_LOCKED', `Marks cannot be changed while the examination is ${exam.status}.`);
  if (exam.date > todayISO(college.settings.timezone)) throw badRequest('Marks cannot be entered before the examination date.', undefined, 'EXAM_NOT_HELD');
  if (exam.revision > 1 && !reason) throw badRequest('Give a reason for correcting marks after a reopen.', undefined, 'REASON_REQUIRED');

  const enrolled = new Set((await StudentProfile.find({ section: exam.section, active: true }).select('_id').lean()).map(s => String(s._id)));
  const errors = []; const seen = new Set();
  entries.forEach((e, i) => {
    const field = `entries.${i}`;
    if (!enrolled.has(e.studentId)) errors.push({ field, message: 'Not enrolled in this class.' });
    else if (seen.has(e.studentId)) errors.push({ field, message: 'Listed twice.' });
    else if (!e.absent && e.marks !== null && e.marks !== undefined && (!Number.isFinite(e.marks) || e.marks < 0 || e.marks > exam.maxMarks)) errors.push({ field, message: `Marks must be between 0 and ${exam.maxMarks}.` });
    else if (e.absent && e.marks) errors.push({ field, message: 'An absent student cannot have marks.' });
    seen.add(e.studentId);
  });
  if (errors.length) throw badRequest('Some marks are invalid. Nothing was saved.', errors, 'INVALID_MARKS');

  const existing = new Map((await MarksEntry.find({ exam: exam._id }).lean()).map(m => [String(m.student), m]));
  const ops = [];
  for (const e of entries) {
    const marks = e.absent ? null : (e.marks ?? null);
    const prev = existing.get(e.studentId);
    if (prev && prev.marks === marks && prev.absent === Boolean(e.absent) && (prev.remark || '') === (e.remark || '')) continue;
    const note = { marks, absent: Boolean(e.absent), by: actor._id, at: new Date(), reason: reason || '', revision: exam.revision };
    ops.push({ updateOne: {
      filter: { exam: exam._id, student: e.studentId },
      update: { $set: { marks, absent: Boolean(e.absent), remark: e.remark || '', updatedBy: actor._id, college: college._id }, $setOnInsert: { enteredBy: actor._id }, $push: { history: note } },
      upsert: true
    } });
  }
  if (ops.length) await MarksEntry.bulkWrite(ops, { ordered: false });
  if (exam.status === X.DRAFT) { exam.status = X.MARKS_ENTRY; await exam.save(); }
  await audit.record({ actor, collegeId: college._id, action: exam.revision > 1 ? 'marks.corrected' : 'marks.saved', entityType: 'Exam', entityId: exam._id, meta: { changed: ops.length, reason } });
  return { changed: ops.length, status: exam.status };
}

/** Validation shared by submit and publish: everyone enrolled has marks or is marked absent. */
async function missingMarks(exam) {
  const enrolled = await StudentProfile.find({ section: exam.section, active: true }).select('_id').lean();
  const done = new Set((await MarksEntry.find({ exam: exam._id, $or: [{ absent: true }, { marks: { $ne: null } }] }).select('student').lean()).map(m => String(m.student)));
  return enrolled.filter(s => !done.has(String(s._id))).map(s => String(s._id));
}

/* ------------------------------------------------------------- lifecycle */

async function step(exam, from, to, set = {}) {
  const res = await Exam.updateOne({ _id: exam._id, status: { $in: from } }, { $set: { status: to, ...set } });
  if (!res.modifiedCount) throw conflict('INVALID_TRANSITION', `The examination is ${exam.status}; it cannot move to ${to} from there.`);
  return Exam.findById(exam._id);
}

async function submit({ actor, perms, college, id }) {
  const exam = await loadExam(college._id, id);
  await assertCanEnter(actor, perms, exam);
  if (exam.status !== X.MARKS_ENTRY) throw conflict('INVALID_TRANSITION', 'Enter marks first.');
  const missing = await missingMarks(exam);
  if (missing.length) throw conflict('INCOMPLETE_MARKS', `${missing.length} student(s) have no marks and are not marked absent.`, { missing });
  const out = await step(exam, [X.MARKS_ENTRY], X.SUBMITTED, { submittedBy: actor._id, submittedAt: new Date() });
  await audit.record({ actor, collegeId: college._id, action: 'marks.submitted', entityType: 'Exam', entityId: exam._id });
  return out;
}

async function review({ actor, perms, college, id, decision, reason }) {
  const exam = await loadExam(college._id, id);
  if (!perms.can('marks.review')) throw forbidden();
  if (exam.status !== X.SUBMITTED) throw conflict('INVALID_TRANSITION', 'Only submitted marks can be reviewed.');
  if (!perms.isSuper && String(exam.submittedBy) === String(actor._id)) throw forbidden('You cannot review marks you submitted yourself.', 'SEPARATION_OF_DUTIES');
  if (decision === 'return') {
    if (!reason) throw badRequest('Say what needs to be corrected.', undefined, 'REASON_REQUIRED');
    const out = await step(exam, [X.SUBMITTED], X.MARKS_ENTRY);
    await audit.record({ actor, collegeId: college._id, action: 'marks.returned', entityType: 'Exam', entityId: exam._id, meta: { reason } });
    return out;
  }
  const out = await step(exam, [X.SUBMITTED], X.REVIEWED, { reviewedBy: actor._id, reviewedAt: new Date() });
  await audit.record({ actor, collegeId: college._id, action: 'marks.reviewed', entityType: 'Exam', entityId: exam._id });
  return out;
}

async function lock({ actor, perms, college, id }) {
  const exam = await loadExam(college._id, id);
  if (!perms.can('results.publish')) throw forbidden();
  const out = await step(exam, [X.REVIEWED], X.LOCKED, { lockedBy: actor._id, lockedAt: new Date() });
  await audit.record({ actor, collegeId: college._id, action: 'results.locked', entityType: 'Exam', entityId: exam._id });
  return out;
}

/** Publication: needs a grading policy and complete marks; freezes each student's official result. */
async function publish({ actor, perms, college, id }) {
  const exam = await loadExam(college._id, id);
  if (!perms.can('results.publish')) throw forbidden();
  if (exam.status !== X.LOCKED) throw conflict('INVALID_TRANSITION', 'Results must be locked before they are published.');
  const policy = await getPolicy(college._id);
  if (!policy) throw badRequest('Define the grading policy before publishing results.', undefined, 'NO_GRADING_POLICY');
  const missing = await missingMarks(exam);
  if (missing.length) throw conflict('INCOMPLETE_MARKS', `${missing.length} student(s) have no marks.`, { missing });

  const entries = await MarksEntry.find({ exam: exam._id }).lean();
  const now = new Date();
  await MarksEntry.bulkWrite(entries.map(e => {
    const r = gradeResult(e, exam, policy);
    return { updateOne: { filter: { _id: e._id }, update: { $set: { final: { ...r, policyVersion: policy.version, revision: exam.revision, at: now } } } } };
  }));
  const out = await step(exam, [X.LOCKED], X.PUBLISHED, { publishedBy: actor._id, publishedAt: now });
  await audit.record({ actor, collegeId: college._id, action: 'results.published', entityType: 'Exam', entityId: exam._id, meta: { revision: exam.revision, policyVersion: policy.version } });

  const subject = await Subject.findById(exam.subject).select('name').lean();
  const students = await StudentProfile.find({ _id: { $in: entries.map(e => e.student) } }).select('user').lean();
  for (const s of students) {
    await notifications.notify({
      collegeId: college._id, userId: s.user, type: NOTIFICATION_TYPES.RESULT, title: `Result published: ${subject.name}`,
      message: `Your result for ${exam.name} is now available.`, data: { examId: String(exam._id) },
      dedupeKey: `result:${exam._id}:${exam.revision}`, link: 'student.html#results'
    });
  }
  return out;
}

/** Locked or published results are only changed through a documented reopen. */
async function reopen({ actor, perms, college, id, reason }) {
  const exam = await loadExam(college._id, id);
  if (!perms.can('results.reopen')) throw forbidden();
  if (![X.LOCKED, X.PUBLISHED, X.REVIEWED].includes(exam.status)) throw conflict('INVALID_TRANSITION', 'Only reviewed, locked or published results can be reopened.');
  const from = exam.status;
  const res = await Exam.updateOne({ _id: exam._id, status: from }, {
    $set: { status: X.MARKS_ENTRY }, $inc: { revision: 1 }, $push: { reopenLog: { at: new Date(), by: actor._id, reason, fromStatus: from } }
  });
  if (!res.modifiedCount) throw conflict('INVALID_TRANSITION', 'The examination changed state; reload and try again.');
  await audit.record({ actor, collegeId: college._id, action: 'results.reopened', entityType: 'Exam', entityId: exam._id, meta: { reason, from } });
  return Exam.findById(exam._id);
}

module.exports = {
  getPolicy, savePolicy, create, update, remove, list, marksSheet, saveMarks, submit, review, lock, publish, reopen, loadExam
};
