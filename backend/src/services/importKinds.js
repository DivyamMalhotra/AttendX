const crypto = require('crypto');
const { Section, StudentProfile, User } = require('../models');
const { Book } = require('../models/Facilities');
const { Exam } = require('../models/Exam');
const { isFormulaLike } = require('../utils/csvParse');
const { normalizeRollNo, isValidRollNo } = require('../utils/rollNumber');
const { allowedSectionIds } = require('./permissionService');
const { badRequest, notFound } = require('../utils/errors');
const students = require('./studentService');
const library = require('./libraryService');
const exams = require('./examService');
const passwordReset = require('./passwordResetService');

/**
 * What each bulk import knows how to do. Every kind declares its columns, validates one row at a time against
 * data preloaded once in `prepare` (so a 2,000-row file costs a handful of queries, not 2,000), and applies a row
 * through the same service the normal screen uses, so imports obey every rule of the manual path.
 *
 * Free-text columns reject values that start with = + - @ (spreadsheet formulas) so imported data can never turn
 * into a formula when it is exported again.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const text = (raw, key, label, { required = false, max = 120, min = 0 } = {}) => {
  const v = String(raw[key] ?? '').trim();
  if (!v) return required ? { error: `${label} is required.` } : { value: '' };
  if (v.length < min) return { error: `${label} must be at least ${min} characters.` };
  if (v.length > max) return { error: `${label} is longer than ${max} characters.` };
  if (isFormulaLike(v)) return { error: `${label} must not start with = + - or @.` };
  return { value: v };
};
const collect = (errors, r) => { if (r.error) errors.push(r.error); return r.value; };

/* ------------------------------------------------------------------ students */
const studentsKind = {
  label: 'Students', permission: 'students.manage',
  columns: ['name', 'email', 'rollno', 'section', 'phone', 'admissionyear'], required: ['name', 'email', 'rollno', 'section'],
  template: 'name,email,rollno,section,phone,admissionyear\r\nAsha Verma,asha.verma@example.edu,CSE2026001,CS-B,9876543210,2026\r\n',
  async prepare({ college, req }) {
    const allowed = await allowedSectionIds(req, 'students.manage');
    const sections = await Section.find({ college: college._id, ...(allowed ? { _id: { $in: allowed } } : {}) }).select('name nameKey').lean();
    const [rolls, emails] = await Promise.all([
      StudentProfile.find({ college: college._id }).select('rollNo').lean(),
      User.find({ college: college._id }).select('email').lean()
    ]);
    return {
      sections: new Map(sections.map(s => [String(s.name).trim().toLowerCase(), s])),
      rolls: new Set(rolls.map(r => r.rollNo)), emails: new Set(emails.map(u => u.email))
    };
  },
  validate(raw, ctx) {
    const errors = [];
    const name = collect(errors, text(raw, 'name', 'Name', { required: true, min: 2 }));
    const email = String(raw.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) errors.push('Email is not valid.');
    else if (ctx.emails.has(email)) errors.push('A user with this email already exists.');
    const rollNo = normalizeRollNo(raw.rollno);
    if (!isValidRollNo(rollNo)) errors.push('Roll number must be 3-25 letters, digits, "-" or "/".');
    else if (ctx.rolls.has(rollNo)) errors.push('This roll number already exists.');
    const section = ctx.sections.get(String(raw.section ?? '').trim().toLowerCase());
    if (!section) errors.push('Section not found (or outside your departments).');
    const phone = collect(errors, text(raw, 'phone', 'Phone', { max: 20 }));
    const year = String(raw.admissionyear ?? '').trim();
    if (year && !/^(19|20)\d{2}$/.test(year)) errors.push('Admission year must be a 4-digit year.');
    return { data: { name, email, rollNo, sectionId: section && String(section._id), phone, admissionYear: year ? Number(year) : undefined }, errors };
  },
  keys: d => [`email:${d.email}`, `roll:${d.rollNo}`],
  async apply({ actor, college, data, batch }) {
    // The student gets an unusable random password and a "set your password" e-mail: no password ever sits in the file or the batch.
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1`;
    await students.registerStudent(actor, college._id, { ...data, password });
    batch.extras.welcomeRequested = (batch.extras.welcomeRequested || 0) + 1;
    try { await passwordReset.request({ collegeCode: college.code, email: data.email }); } catch (e) { batch.extras.welcomeFailed = (batch.extras.welcomeFailed || 0) + 1; }
    return { state: 'ok' };
  }
};

/* --------------------------------------------------------------------- marks */
const ABSENT = new Set(['ab', 'absent', 'a', 'yes', 'true', '1']);
const marksKind = {
  label: 'Examination marks', permission: 'marks.upload',
  columns: ['rollno', 'marks', 'absent', 'remark'], required: ['rollno'],
  template: 'rollno,marks,absent,remark\r\nCSE2026001,42,,\r\nCSE2026002,,yes,Medical\r\n',
  batch: true,
  async prepare({ college, params }) {
    if (!params.examId) throw badRequest('Choose the examination these marks belong to.', undefined, 'EXAM_REQUIRED');
    const exam = await Exam.findOne({ _id: params.examId, college: college._id });
    if (!exam) throw notFound('Examination not found.');
    const enrolled = await StudentProfile.find({ section: exam.section, active: true }).select('rollNo').lean();
    return { exam, byRoll: new Map(enrolled.map(s => [s.rollNo, String(s._id)])) };
  },
  validate(raw, ctx) {
    const errors = [];
    const rollNo = normalizeRollNo(raw.rollno);
    const studentId = ctx.byRoll.get(rollNo);
    if (!studentId) errors.push('This roll number is not in the examination\'s class.');
    const absent = ABSENT.has(String(raw.absent ?? '').trim().toLowerCase()) || /^ab$/i.test(String(raw.marks ?? '').trim());
    let marks = null;
    const m = String(raw.marks ?? '').trim();
    if (!absent && m !== '') {
      marks = Number(m);
      if (!Number.isFinite(marks) || marks < 0 || marks > ctx.exam.maxMarks) errors.push(`Marks must be a number from 0 to ${ctx.exam.maxMarks}.`);
    } else if (absent && m !== '' && !/^ab$/i.test(m) && Number(m) !== 0) errors.push('An absent student cannot have marks.');
    const remark = collect(errors, text(raw, 'remark', 'Remark', { max: 200 }));
    return { data: { rollNo, studentId, marks: absent ? null : marks, absent, remark }, errors };
  },
  keys: d => [`roll:${d.rollNo}`],
  async applyBatch({ actor, perms, college, rows, params }) {
    const entries = rows.map(r => ({ studentId: r.data.studentId, marks: r.data.marks, absent: r.data.absent, remark: r.data.remark }));
    const res = await exams.saveMarks({ actor, perms, college, id: params.examId, entries, reason: params.reason });
    return { state: 'ok', message: `${res.changed} changed` };
  }
};

module.exports = { students: studentsKind, marks: marksKind };
