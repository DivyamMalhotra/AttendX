const { Attendance, DutyLeaveDay, Subject, StudentProfile } = require('../models');
const math = require('../utils/attendanceMath');

const k = (a, b) => `${a}|${b}`;

/**
 * The single place where attendance numbers are computed (dashboards, alerts, reports).
 * Raw attendance records are never modified by duty leave; instead approved duty leave
 * days are applied here, at read time, according to the college's duty leave policy.
 *
 * Returns a lookup  get(studentId, subjectId) -> { attended, missed, exempt, eligible, recorded, percentage }
 */
async function computeStats({ collegeId, studentIds, subjectIds, settings }) {
  if (!studentIds.length) return { get: () => emptySummary() };

  const match = { college: collegeId, student: { $in: studentIds } };
  if (subjectIds) match.subject = { $in: subjectIds };

  const [counts, absences, leaveDays] = await Promise.all([
    Attendance.aggregate([
      { $match: match },
      { $group: { _id: { s: '$student', sub: '$subject', st: '$status' }, n: { $sum: 1 } } }
    ]),
    Attendance.find({ ...match, status: 'A' }).select('student subject date').lean(),
    // only days of leave types that exempt attendance count (a missing flag is legacy duty leave: exempt)
    DutyLeaveDay.find({ college: collegeId, student: { $in: studentIds }, state: 'approved', exempt: { $ne: false } }).select('student date').lean()
  ]);

  const raw = new Map();
  const slot = key => {
    if (!raw.has(key)) raw.set(key, { present: 0, absent: 0, exempt: 0 });
    return raw.get(key);
  };
  counts.forEach(c => {
    const row = slot(k(c._id.s, c._id.sub));
    if (c._id.st === 'P') row.present += c.n; else row.absent += c.n;
  });

  const leaveSet = new Set(leaveDays.map(d => k(d.student, d.date)));
  absences.forEach(a => {
    if (leaveSet.has(k(a.student, a.date))) slot(k(a.student, a.subject)).exempt += 1;
  });

  return {
    get(studentId, subjectId) {
      const row = raw.get(k(studentId, subjectId)) || { present: 0, absent: 0, exempt: 0 };
      const s = math.summarize(row, settings.dutyLeavePolicy);
      return { ...s, percentage: math.percentage(s.attended, s.eligible) };
    }
  };
}

function emptySummary() {
  return { attended: 0, missed: 0, exempt: 0, eligible: 0, recorded: 0, percentage: null };
}

/** Adds threshold-dependent fields to a summary. */
function withPolicy(summary, threshold) {
  const below = math.isBelowThreshold(summary.attended, summary.eligible, threshold);
  let status = 'no_data';
  if (summary.eligible > 0) {
    if (below) status = 'shortage';
    else if (summary.percentage < threshold + 5) status = 'borderline';
    else status = 'good';
  }
  return {
    ...summary,
    status,
    belowThreshold: below,
    classesNeeded: below ? math.classesNeededToReach(summary.attended, summary.eligible, threshold) : 0,
    canSkip: below || summary.eligible === 0 ? 0 : math.classesCanSkip(summary.attended, summary.eligible, threshold)
  };
}

/** Subject-wise attendance for one student, plus an overall roll-up. */
async function studentOverview(profile, settings) {
  const subjects = await Subject.find({ section: profile.section }).populate('teacher', 'name').sort({ name: 1 }).lean();
  const stats = await computeStats({
    collegeId: profile.college, studentIds: [profile._id], subjectIds: subjects.map(s => s._id), settings
  });
  const threshold = settings.attendanceThreshold;

  const rows = subjects.map(s => ({
    subject: { id: String(s._id), name: s.name, code: s.code, teacher: s.teacher ? s.teacher.name : null },
    ...withPolicy(stats.get(profile._id, s._id), threshold)
  }));

  const totals = rows.reduce((t, r) => ({
    attended: t.attended + r.attended, eligible: t.eligible + r.eligible, missed: t.missed + r.missed, exempt: t.exempt + r.exempt
  }), { attended: 0, eligible: 0, missed: 0, exempt: 0 });

  return {
    threshold,
    dutyLeavePolicy: settings.dutyLeavePolicy,
    overall: { ...totals, percentage: math.percentage(totals.attended, totals.eligible) },
    subjects: rows,
    shortages: rows.filter(r => r.belowThreshold)
  };
}

/** Per-student percentages for one subject (faculty summary view and reports). */
async function subjectSummary(subject, settings) {
  const students = await StudentProfile.find({ section: subject.section, active: true }).populate('user', 'name').sort({ rollNo: 1 }).lean();
  const stats = await computeStats({
    collegeId: subject.college, studentIds: students.map(s => s._id), subjectIds: [subject._id], settings
  });
  return students.map(st => ({
    student: { id: String(st._id), rollNo: st.rollNo, name: st.user ? st.user.name : '' },
    ...withPolicy(stats.get(st._id, subject._id), settings.attendanceThreshold)
  }));
}

module.exports = { computeStats, withPolicy, studentOverview, subjectSummary };
