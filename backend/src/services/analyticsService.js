const { Section, Subject, StudentProfile, Attendance, FeeAssignment, Payment, DutyLeaveRequest, Department, User } = require('../models');
const { Exam, MarksEntry } = require('../models/Exam');
const { Assignment, AssignmentSubmission } = require('../models/Assignment');
const { LibraryIssue } = require('../models/Facilities');
const stats = require('./attendanceStatsService');
const math = require('../utils/attendanceMath');
const { outstandingPaise } = require('../utils/feeMath');
const { todayISO, addDays } = require('../utils/dates');

/**
 * Analytics. Everything here is computed on demand from the system of record (nothing is copied into a
 * reporting table), is limited to the sections the viewer's permission covers (`sectionIds`, null = whole college),
 * and contains aggregates or, for the at-risk list, only flag codes: never marks of unpublished work, medical leave
 * details, counselling notes or payment transaction data.
 */
const MAX_STUDENTS = 5000;
const BUCKETS = [['<50', 0, 50], ['50-64', 50, 65], ['65-74', 65, 75], ['75-84', 75, 85], ['85+', 85, 101]];
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

async function scope(college, sectionIds) {
  const filter = { college: college._id, ...(sectionIds ? { _id: { $in: sectionIds } } : {}) };
  const sections = await Section.find(filter).populate('department', 'name code').lean();
  const students = await StudentProfile.find({ college: college._id, section: { $in: sections.map(s => s._id) }, active: true }).select('_id section rollNo user').limit(MAX_STUDENTS).lean();
  return { sections, students };
}

/** Overall attendance per student (all subjects of the section) using the shared statistics service. */
async function studentAttendance(college, sections, students) {
  const subjects = await Subject.find({ college: college._id, section: { $in: sections.map(s => s._id) } }).select('_id section').lean();
  const bySection = new Map();
  subjects.forEach(s => { const k = String(s.section); bySection.set(k, [...(bySection.get(k) || []), s._id]); });
  const result = await stats.computeStats({ collegeId: college._id, studentIds: students.map(s => s._id), subjectIds: subjects.map(s => s._id), settings: college.settings });
  const out = new Map();
  for (const st of students) {
    let attended = 0; let eligible = 0;
    for (const sub of bySection.get(String(st.section)) || []) {
      const r = result.get(st._id, sub);
      attended += r.attended; eligible += r.eligible;
    }
    out.set(String(st._id), { attended, eligible, percentage: math.percentage(attended, eligible) });
  }
  return out;
}

async function attendanceBlock(college, sections, students) {
  const att = await studentAttendance(college, sections, students);
  const distribution = BUCKETS.map(([label]) => ({ label, students: 0 }));
  const sectionAgg = new Map(sections.map(s => [String(s._id), { attended: 0, eligible: 0, below: 0, students: 0 }]));
  let noData = 0; let below = 0;
  for (const st of students) {
    const a = att.get(String(st._id));
    const agg = sectionAgg.get(String(st.section));
    agg.students += 1;
    if (a.percentage === null) { noData += 1; continue; }
    agg.attended += a.attended; agg.eligible += a.eligible;
    BUCKETS.forEach(([, lo, hi], i) => { if (a.percentage >= lo && a.percentage < hi) distribution[i].students += 1; });
    if (math.isBelowThreshold(a.attended, a.eligible, college.settings.attendanceThreshold)) { below += 1; agg.below += 1; }
  }
  const total = [...sectionAgg.values()].reduce((t, a) => ({ attended: t.attended + a.attended, eligible: t.eligible + a.eligible }), { attended: 0, eligible: 0 });
  return {
    threshold: college.settings.attendanceThreshold, average: pct(total.attended, total.eligible), belowThreshold: below, noData, distribution,
    bySection: sections.map(s => {
      const a = sectionAgg.get(String(s._id));
      return { sectionId: String(s._id), section: `${s.name} · ${s.sem || ''}`.trim(), department: s.department ? s.department.name : null, departmentId: s.department ? String(s.department._id) : null, students: a.students, average: pct(a.attended, a.eligible), belowThreshold: a.below };
    })
  };
}

/** Weekly present-rate over the last 8 weeks, for the scoped sections (raw marks, before leave adjustments). */
async function attendanceTrend(college, sections, today) {
  const from = addDays(today, -55);
  const rows = await Attendance.aggregate([
    { $match: { college: college._id, section: { $in: sections.map(s => s._id) }, date: { $gte: from, $lte: today } } },
    { $group: { _id: { date: '$date', st: '$status' }, n: { $sum: 1 } } }
  ]);
  const weeks = Array.from({ length: 8 }, (_, i) => ({ from: addDays(today, -(7 * (7 - i) + 6)), to: addDays(today, -(7 * (7 - i))), present: 0, total: 0 }));
  rows.forEach(r => {
    const w = weeks.find(x => r._id.date >= x.from && r._id.date <= x.to);
    if (w) { w.total += r.n; if (r._id.st === 'P') w.present += r.n; }
  });
  return weeks.map(w => ({ weekStart: w.from, presentRate: pct(w.present, w.total), marks: w.total }));
}

async function feesBlock(college, students, sessionId, today) {
  const ids = students.map(s => s._id);
  const fees = await FeeAssignment.find({ college: college._id, student: { $in: ids }, ...(sessionId ? { academicSession: sessionId } : {}) })
    .select('category totalPayablePaise paidPaise dueDate student').lean();
  const t = { payable: 0, paid: 0, outstanding: 0, paidCount: 0, partial: 0, unpaid: 0, overdue: 0, overdueAmount: 0 };
  const byCategory = {};
  for (const f of fees) {
    const out = outstandingPaise(f);
    t.payable += f.totalPayablePaise; t.paid += f.paidPaise; t.outstanding += out;
    if (out === 0) t.paidCount += 1; else if (f.paidPaise > 0) t.partial += 1; else t.unpaid += 1;
    if (out > 0 && f.dueDate && f.dueDate < today) { t.overdue += 1; t.overdueAmount += out; }
    const c = byCategory[f.category] || (byCategory[f.category] = { payable: 0, paid: 0 });
    c.payable += f.totalPayablePaise; c.paid += f.paidPaise;
  }
  const since = new Date(`${addDays(today, -29)}T00:00:00+05:30`);
  const daily = await Payment.aggregate([
    { $match: { college: college._id, student: { $in: ids }, status: 'success', paidAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: college.settings.timezone } }, amount: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  return {
    totalPayablePaise: t.payable, collectedPaise: t.paid, outstandingPaise: t.outstanding, collectionRate: pct(t.paid, t.payable),
    counts: { paid: t.paidCount, partial: t.partial, unpaid: t.unpaid, overdue: t.overdue }, overduePaise: t.overdueAmount,
    byCategory: Object.entries(byCategory).map(([category, v]) => ({ category, payablePaise: v.payable, collectedPaise: v.paid })),
    last30Days: daily.map(d => ({ date: d._id, amountPaise: d.amount, payments: d.count }))
  };
}

/** Published results only, current revision only. */
async function resultsBlock(college, sections, students, sessionId) {
  const exams = await Exam.find({ college: college._id, status: 'published', section: { $in: sections.map(s => s._id) }, ...(sessionId ? { academicSession: sessionId } : {}) }).select('_id revision name').lean();
  if (!exams.length) return { exams: 0, passRate: null, grades: [], byExam: [] };
  const entries = await MarksEntry.find({ exam: { $in: exams.map(e => e._id) }, student: { $in: students.map(s => s._id) }, 'final.state': { $exists: true } }).select('exam final').lean();
  const rev = new Map(exams.map(e => [String(e._id), e]));
  const grades = new Map(); const per = new Map();
  let pass = 0; let sat = 0;
  for (const e of entries) {
    const exam = rev.get(String(e.exam));
    if (!exam || e.final.revision !== exam.revision || e.final.state === 'absent') continue;
    sat += 1; if (e.final.passed) pass += 1;
    grades.set(e.final.grade, (grades.get(e.final.grade) || 0) + 1);
    const p = per.get(String(e.exam)) || { name: exam.name, sat: 0, pass: 0 };
    p.sat += 1; if (e.final.passed) p.pass += 1;
    per.set(String(e.exam), p);
  }
  return {
    exams: exams.length, passRate: pct(pass, sat),
    grades: [...grades.entries()].map(([grade, students]) => ({ grade, students })).sort((a, b) => b.students - a.students),
    byExam: [...per.values()].map(p => ({ exam: p.name, appeared: p.sat, passRate: pct(p.pass, p.sat) }))
  };
}

/** Counts only: leave is aggregated by type and status, so a medical request is never tied to a person here. */
async function leaveBlock(college, students) {
  const rows = await DutyLeaveRequest.aggregate([
    { $match: { college: college._id, student: { $in: students.map(s => s._id) } } },
    { $lookup: { from: 'leavetypes', localField: 'leaveType', foreignField: '_id', as: 't' } },
    { $group: { _id: { type: { $ifNull: [{ $arrayElemAt: ['$t.name', 0] }, 'Duty leave'] }, status: '$status' }, n: { $sum: 1 } } }
  ]);
  const byType = {};
  rows.forEach(r => { (byType[r._id.type] = byType[r._id.type] || {})[r._id.status] = r.n; });
  return { byType: Object.entries(byType).map(([type, statuses]) => ({ type, ...statuses })) };
}

/** Library figures are institution-level: only returned when the viewer is not restricted to some departments. */
async function facilitiesBlock(college, today) {
  const [issued, overdue] = await Promise.all([
    LibraryIssue.countDocuments({ college: college._id, status: 'issued' }),
    LibraryIssue.countDocuments({ college: college._id, status: 'issued', dueDate: { $lt: today } })
  ]);
  return { library: { onLoan: issued, overdue } };
}

function byDepartment(att, sections) {
  const map = new Map();
  for (const s of att.bySection) {
    const key = s.departmentId || 'none';
    const d = map.get(key) || { departmentId: s.departmentId, department: s.department || 'Unassigned', sections: 0, students: 0, belowThreshold: 0, weighted: 0, weight: 0 };
    d.sections += 1; d.students += s.students; d.belowThreshold += s.belowThreshold;
    if (s.average !== null) { d.weighted += s.average * s.students; d.weight += s.students; }
    map.set(key, d);
  }
  return [...map.values()].map(({ weighted, weight, ...d }) => ({ ...d, averageAttendance: weight ? Math.round((weighted / weight) * 10) / 10 : null }));
}

async function overview({ college, sectionIds, sessionId }) {
  const today = todayISO(college.settings.timezone);
  const { sections, students } = await scope(college, sectionIds);
  const empty = !students.length;
  const [attendance, trend, fees, results, leave, facilities] = await Promise.all([
    empty ? null : attendanceBlock(college, sections, students),
    empty ? [] : attendanceTrend(college, sections, today),
    empty ? null : feesBlock(college, students, sessionId, today),
    empty ? null : resultsBlock(college, sections, students, sessionId),
    empty ? null : leaveBlock(college, students),
    sectionIds ? null : facilitiesBlock(college, today)
  ]);
  return {
    generatedAt: new Date(), scope: sectionIds ? 'department' : 'college',
    totals: { sections: sections.length, students: students.length, capped: students.length >= MAX_STUDENTS },
    attendance, attendanceTrend: trend, departments: attendance ? byDepartment(attendance, sections) : [], fees, results, leave, facilities
  };
}

/* ------------------------------------------------------------------ at-risk */

/**
 * `studentIds` limits the list to those students (a teacher's mentees) and `attendanceOnly` leaves fee, result and
 * assignment flags out, so a teacher sees attendance standing only.
 */
async function atRisk({ college, sectionIds, limit = 100, studentIds = null, attendanceOnly = false }) {
  const cfg = college.settings.atRisk;
  const today = todayISO(college.settings.timezone);
  const scoped = await scope(college, sectionIds);
  const sections = scoped.sections;
  const students = studentIds ? scoped.students.filter(s => studentIds.has(String(s._id))) : scoped.students;
  if (!students.length) return { rows: [], total: 0, criteria: cfg };
  const ids = students.map(s => s._id);

  const flags = new Map(students.map(s => [String(s._id), []]));
  const add = (id, flag) => flags.get(String(id)).push(flag);

  const att = await studentAttendance(college, sections, students);
  for (const st of students) {
    const a = att.get(String(st._id));
    if (a.percentage !== null && a.percentage < cfg.attendanceBelow) add(st._id, { code: 'attendance', detail: `${a.percentage}% attendance` });
  }
  if (cfg.flagOverdueFees && !attendanceOnly) {
    const fees = await FeeAssignment.find({ college: college._id, student: { $in: ids }, dueDate: { $lt: today }, $expr: { $gt: ['$totalPayablePaise', '$paidPaise'] } }).select('student totalPayablePaise paidPaise').lean();
    const per = new Map();
    fees.forEach(f => per.set(String(f.student), (per.get(String(f.student)) || 0) + outstandingPaise(f)));
    per.forEach((amount, id) => add(id, { code: 'fees', detail: 'Overdue fees', amountPaise: amount }));
  }
  if (cfg.flagFailingResults && !attendanceOnly) {
    const exams = await Exam.find({ college: college._id, status: 'published', section: { $in: sections.map(s => s._id) } }).select('_id revision').lean();
    const rev = new Map(exams.map(e => [String(e._id), e.revision]));
    const failed = await MarksEntry.find({ exam: { $in: exams.map(e => e._id) }, student: { $in: ids }, 'final.passed': false, 'final.state': { $ne: 'absent' } }).select('exam student final').lean();
    const per = new Map();
    failed.filter(e => rev.get(String(e.exam)) === e.final.revision).forEach(e => per.set(String(e.student), (per.get(String(e.student)) || 0) + 1));
    per.forEach((n, id) => add(id, { code: 'results', detail: `${n} failed subject${n > 1 ? 's' : ''}` }));
  }
  if (cfg.flagMissingAssignments && !attendanceOnly) {
    const now = new Date();
    const assignments = await Assignment.find({ college: college._id, section: { $in: sections.map(s => s._id) }, status: { $in: ['published', 'closed'] }, deadline: { $lt: now }, $or: [{ publishAt: null }, { publishAt: { $lte: now } }] }).select('_id section').lean();
    const subs = await AssignmentSubmission.find({ assignment: { $in: assignments.map(a => a._id) }, student: { $in: ids } }).select('assignment student').lean();
    const done = new Set(subs.map(s => `${s.student}|${s.assignment}`));
    const bySection = new Map();
    assignments.forEach(a => bySection.set(String(a.section), [...(bySection.get(String(a.section)) || []), a._id]));
    for (const st of students) {
      const missing = (bySection.get(String(st.section)) || []).filter(a => !done.has(`${st._id}|${a}`)).length;
      if (missing > 0) add(st._id, { code: 'assignments', detail: `${missing} assignment${missing > 1 ? 's' : ''} not submitted` });
    }
  }

  const users = new Map((await User.find({ _id: { $in: students.map(s => s.user) } }).select('name').lean()).map(u => [String(u._id), u.name]));
  const secName = new Map(sections.map(s => [String(s._id), `${s.name} · ${s.sem || ''}`.trim()]));
  const rows = students.filter(s => flags.get(String(s._id)).length >= cfg.minFlags).map(s => ({
    studentId: String(s._id), rollNo: s.rollNo, name: users.get(String(s.user)) || '', section: secName.get(String(s.section)),
    attendance: att.get(String(s._id)).percentage, flags: flags.get(String(s._id))
  })).sort((a, b) => b.flags.length - a.flags.length || (a.attendance ?? 101) - (b.attendance ?? 101));
  return { rows: rows.slice(0, limit), total: rows.length, criteria: cfg };
}

module.exports = { overview, atRisk, MAX_STUDENTS };
