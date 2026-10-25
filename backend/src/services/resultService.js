const crypto = require('crypto');
const { Exam, MarksEntry, StudentProfile } = require('../models');
const { EXAM_STATUS: X } = require('../config/constants');
const { config } = require('../config/env');
const { gpa } = require('../utils/grading');

/**
 * A student's official results. Only PUBLISHED examinations are ever read, and grades come from the
 * snapshot frozen at publication, so unpublished or reopened results are invisible and later
 * policy edits cannot change what was published.
 */
async function forStudent(studentId) {
  const entries = await MarksEntry.find({ student: studentId, 'final.state': { $exists: true } }).lean();
  if (!entries.length) return { semesters: [], cgpa: null };
  const exams = await Exam.find({ _id: { $in: entries.map(e => e.exam) }, status: X.PUBLISHED })
    .populate('subject', 'name code credits').populate('academicSession', 'name startDate').lean();
  const byExam = new Map(entries.map(e => [String(e.exam), e]));

  const groups = new Map();
  for (const exam of exams) {
    const entry = byExam.get(String(exam._id));
    // a reopened-and-republished exam must show the latest revision only
    if (!entry || entry.final.revision !== exam.revision) continue;
    const key = `${exam.academicSession._id}|${exam.semesterNumber}`;
    if (!groups.has(key)) groups.set(key, { session: { id: String(exam.academicSession._id), name: exam.academicSession.name, startDate: exam.academicSession.startDate }, semesterNumber: exam.semesterNumber, exams: [] });
    groups.get(key).exams.push({
      examId: String(exam._id), exam: exam.name, type: exam.type, date: exam.date, subject: exam.subject.name, subjectCode: exam.subject.code,
      subjectId: String(exam.subject._id), credits: exam.subject.credits, maxMarks: exam.maxMarks, passMarks: exam.passMarks, countsForGpa: exam.countsForGpa,
      marks: entry.final.state === 'absent' ? null : entry.marks, state: entry.final.state, percent: entry.final.percent,
      grade: entry.final.grade, points: entry.final.points, passed: entry.final.passed, publishedAt: exam.publishedAt
    });
  }

  const semesters = [...groups.values()].map(g => {
    g.exams.sort((a, b) => a.date.localeCompare(b.date));
    // GPA: one result per subject, the latest GPA-counting exam
    const perSubject = new Map();
    g.exams.filter(e => e.countsForGpa).forEach(e => perSubject.set(e.subjectId, e));
    const counted = [...perSubject.values()];
    return {
      ...g, subjects: counted, gpa: gpa(counted), credits: counted.reduce((t, r) => t + (r.credits || 0), 0),
      status: counted.length === 0 ? null : counted.every(r => r.passed) ? 'PASS' : 'FAIL'
    };
  }).sort((a, b) => (a.session.startDate || '').localeCompare(b.session.startDate || '') || a.semesterNumber - b.semesterNumber);

  const all = semesters.flatMap(s => s.subjects);
  return { semesters, cgpa: gpa(all) };
}

/** Short code printed on report cards so staff can confirm a document is genuine (HMAC, not guessable). */
function verificationCode(studentId, semester) {
  const canonical = `${studentId}|${semester.session.id}|${semester.semesterNumber}|${semester.exams.map(e => `${e.examId}:${e.grade}:${e.marks}`).join(',')}`;
  return crypto.createHmac('sha256', config.sessionSecret).update(canonical).digest('hex').slice(0, 12).toUpperCase();
}

async function reportCardData({ studentId, sessionId, semesterNumber }) {
  const profile = await StudentProfile.findById(studentId).populate('user', 'name').populate('section', 'name course specialization').lean();
  const results = await forStudent(studentId);
  const semester = results.semesters.find(s => s.session.id === String(sessionId) && s.semesterNumber === Number(semesterNumber));
  if (!semester) return null;
  const upTo = results.semesters.filter(s => (s.session.startDate || '') < (semester.session.startDate || '') || (s.session.id === semester.session.id && s.semesterNumber <= semester.semesterNumber));
  return {
    profile, semester, cgpa: gpa(upTo.flatMap(s => s.subjects)), code: verificationCode(String(studentId), semester),
    publishedAt: semester.exams.reduce((latest, e) => (e.publishedAt > latest ? e.publishedAt : latest), semester.exams[0].publishedAt)
  };
}

module.exports = { forStudent, reportCardData, verificationCode };
