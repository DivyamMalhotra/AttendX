const { StudentProfile, Subject, Section, AuditLog, ClassSession } = require('../models');
const stats = require('./attendanceStatsService');

/**
 * Attendance report: one row per student and subject for the chosen section/subject.
 * Uses the same statistics service as the student dashboard, so numbers always agree.
 */
async function attendanceReport({ college, sectionId, subjectId, belowOnly = false, scopeIds = null }) {
  let subjectFilter = { college: college._id };
  if (subjectId) subjectFilter._id = subjectId;
  if (scopeIds) {
    subjectFilter.section = sectionId ? (scopeIds.some(s => String(s) === String(sectionId)) ? sectionId : { $in: [] }) : { $in: scopeIds };
  } else if (sectionId) subjectFilter.section = sectionId;
  const subjects = await Subject.find(subjectFilter).populate('section', 'name sem').lean();
  if (!subjects.length) return [];

  const sectionIds = [...new Set(subjects.map(s => String(s.section._id)))];
  const students = await StudentProfile.find({ college: college._id, section: { $in: sectionIds }, active: true })
    .populate('user', 'name').sort({ rollNo: 1 }).lean();
  const result = await stats.computeStats({
    collegeId: college._id, studentIds: students.map(s => s._id), subjectIds: subjects.map(s => s._id), settings: college.settings
  });

  const rows = [];
  for (const subject of subjects) {
    for (const st of students) {
      if (String(st.section) !== String(subject.section._id)) continue;
      const row = stats.withPolicy(result.get(st._id, subject._id), college.settings.attendanceThreshold);
      if (belowOnly && !row.belowThreshold) continue;
      rows.push({
        studentId: String(st._id), rollNo: st.rollNo, name: st.user ? st.user.name : '',
        section: `${subject.section.name} · ${subject.section.sem}`, subject: subject.name, subjectCode: subject.code, ...row
      });
    }
  }
  return rows.sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101));
}

async function auditLog(collegeId, { action, entityType, skip = 0, limit = 50 }) {
  const filter = { college: collegeId };
  if (action) filter.action = new RegExp(`^${action.replace(/[^\w.]/g, '')}`);
  if (entityType) filter.entityType = entityType;
  const [total, rows] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
  ]);
  return { total, rows };
}

/** Headline numbers for the administrator overview. */
async function overview(college) {
  const month = new Date().toISOString().slice(0, 7);
  const [sections, students, sessionsThisMonth, recent] = await Promise.all([
    Section.countDocuments({ college: college._id }),
    StudentProfile.countDocuments({ college: college._id, active: true }),
    ClassSession.countDocuments({ college: college._id, date: new RegExp(`^${month}`) }),
    ClassSession.find({ college: college._id }).sort({ date: -1, createdAt: -1 }).limit(5)
      .populate('subject', 'name').populate('section', 'name sem').populate('teacher', 'name').lean()
  ]);
  return { sections, students, sessionsThisMonth, recent };
}

module.exports = { attendanceReport, auditLog, overview };
