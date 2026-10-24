const { DutyLeaveRequest, Section, User } = require('../models');
const { Assignment: A, AssignmentSubmission: AS } = require('../models/Assignment');
const stats = require('./attendanceStatsService');
const results = require('./resultService');
const feeView = require('./feeViewService');
const leaveTypes = require('./leaveTypeService');

/**
 * One reader per area of a student's record. Mentors, parents, the timeline and the admin student view all
 * call these, so what is exposed (and what is deliberately left out: medical leave, counselling notes,
 * unpublished marks, payment details) is decided in exactly one place.
 */

const attendance = async (college, profile) => {
  const o = await stats.studentOverview(profile, college.settings);
  return {
    threshold: o.threshold, overall: o.overall,
    subjects: o.subjects.map(s => ({ subject: s.subject.name, attended: s.attended, eligible: s.eligible, percentage: s.percentage, status: s.status, belowThreshold: s.belowThreshold }))
  };
};

/** Leave history without medical (sensitive) types, and without reasons or documents. */
const leave = async (college, profile) => {
  const hidden = await leaveTypes.sensitiveIds(college._id);
  const rows = await DutyLeaveRequest.find({ student: profile._id, leaveType: { $nin: hidden } }).populate('leaveType', 'name').sort({ createdAt: -1 }).limit(20).lean();
  return rows.map(r => ({ id: String(r._id), type: r.leaveType ? r.leaveType.name : 'Duty leave', fromDate: r.fromDate, toDate: r.toDate, status: r.status }));
};

/** Fee position only: balances and status, never transactions or receipts. */
const fees = async (college, profile) => {
  const s = await feeView.studentSummary({ college, profile });
  return {
    totals: s.totals,
    items: s.semesters.map(f => ({ label: f.category === 'semester' ? `Semester ${f.semesterNumber}` : f.description || f.category, session: f.academicSession && f.academicSession.name, totalPayablePaise: f.totalPayablePaise, paidPaise: f.paidPaise, outstandingPaise: f.outstandingPaise, status: f.status, overdue: f.overdue }))
  };
};

const resultsSummary = async profile => {
  const r = await results.forStudent(profile._id);
  return { cgpa: r.cgpa, semesters: r.semesters.map(s => ({ session: s.session.name, semesterNumber: s.semesterNumber, gpa: s.gpa, status: s.status, subjects: s.subjects.map(x => ({ subject: x.subject, grade: x.grade, marks: x.marks, maxMarks: x.maxMarks, passed: x.passed })) })) };
};

/** Published assignments of the class vs what this student handed in. */
const assignments = async (college, profile) => {
  const now = new Date();
  const published = await A.find({ college: college._id, section: profile.section, status: { $in: ['published', 'closed'] }, $or: [{ publishAt: null }, { publishAt: { $lte: now } }] }).select('title deadline').lean();
  const subs = await AS.find({ student: profile._id, assignment: { $in: published.map(p => p._id) } }).select('assignment').lean();
  const done = new Set(subs.map(s => String(s.assignment)));
  const missing = published.filter(p => !done.has(String(p._id)) && p.deadline < now);
  return { total: published.length, submitted: done.size, missing: missing.length, missingTitles: missing.slice(0, 5).map(m => m.title) };
};

const section = async profile => {
  const s = await Section.findById(profile.section).populate('mentor', 'name').lean();
  return s && { name: s.name, sem: s.sem, course: s.course, specialization: s.specialization, semesterNumber: s.semesterNumber, mentor: s.mentor ? s.mentor.name : null };
};

const identity = async profile => {
  const user = await User.findById(profile.user).select('name').lean();
  return { id: String(profile._id), name: user ? user.name : '', rollNo: profile.rollNo, active: profile.active, section: await section(profile) };
};

module.exports = { attendance, leave, fees, results: resultsSummary, assignments, section, identity };
