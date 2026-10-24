const roster = require('../services/rosterService');
const students = require('../services/studentService');
const settings = require('../services/settingsService');
const reports = require('../services/reportService');
const alerts = require('../services/alertService');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, pageMeta } = require('../utils/pagination');
const { toCsv } = require('../utils/csv');

const actorCtx = req => [req.user, req.college._id];
const ok = (res, data, extra = {}) => res.json({ data, ...extra });
const created = (res, data) => res.status(201).json({ data });

/* ---- sections & subjects ---- */
exports.listSections = asyncHandler(async (req, res) => ok(res, await roster.listSections(req.college._id)));
exports.createSection = asyncHandler(async (req, res) => created(res, await roster.createSection(...actorCtx(req), req.body)));
exports.updateSection = asyncHandler(async (req, res) => ok(res, await roster.updateSection(...actorCtx(req), req.params.id, req.body)));
exports.deleteSection = asyncHandler(async (req, res) => { await roster.deleteSection(...actorCtx(req), req.params.id); ok(res, { ok: true }); });
exports.setMentor = asyncHandler(async (req, res) => ok(res, await roster.setMentor(...actorCtx(req), req.params.id, req.body.mentorId)));
exports.createSubject = asyncHandler(async (req, res) => created(res, await roster.createSubject(...actorCtx(req), req.params.id, req.body)));
exports.updateSubject = asyncHandler(async (req, res) => ok(res, await roster.updateSubject(...actorCtx(req), req.params.id, req.body)));
exports.deleteSubject = asyncHandler(async (req, res) => { await roster.deleteSubject(...actorCtx(req), req.params.id); ok(res, { ok: true }); });

/* ---- teachers ---- */
exports.listTeachers = asyncHandler(async (req, res) => ok(res, await roster.listTeachers(req.college._id)));
exports.createTeacher = asyncHandler(async (req, res) => {
  const t = await roster.createTeacher(...actorCtx(req), req.body);
  created(res, t.toPublic());
});
exports.updateTeacher = asyncHandler(async (req, res) => {
  const t = await roster.updateTeacher(...actorCtx(req), req.params.id, req.body);
  ok(res, t.toPublic());
});

/* ---- students ---- */
const presentStudent = (profile, user) => ({
  id: String(profile._id), rollNo: profile.rollNo, name: user.name, email: user.email, phone: profile.phone,
  admissionYear: profile.admissionYear, active: profile.active, sectionId: String(profile.section)
});
exports.listStudents = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await students.listStudents(req.college._id, { ...req.validatedQuery, includeInactive: req.validatedQuery.includeInactive === 'true', ...page });
  ok(res, rows.map(r => ({
    id: String(r._id), rollNo: r.rollNo, name: r.user && r.user.name, email: r.user && r.user.email, phone: r.phone,
    admissionYear: r.admissionYear, active: r.active, section: r.section
  })), { meta: pageMeta(total, page) });
});
exports.createStudent = asyncHandler(async (req, res) => {
  const { user, profile } = await students.registerStudent(...actorCtx(req), req.body);
  created(res, presentStudent(profile, user));
});
exports.updateStudent = asyncHandler(async (req, res) => {
  const { user, profile } = await students.updateStudent(...actorCtx(req), req.params.id, req.body);
  ok(res, presentStudent(profile, user));
});

/* ---- settings & academic sessions ---- */
exports.getSettings = (req, res) => ok(res, { settings: req.college.settings, college: { name: req.college.name, code: req.college.code } });
exports.updateSettings = asyncHandler(async (req, res) => ok(res, await settings.updateSettings(req.user, req.college, req.body)));
exports.listSessions = asyncHandler(async (req, res) => ok(res, await settings.listSessions(req.college._id)));
exports.createSession = asyncHandler(async (req, res) => created(res, await settings.createSession(...actorCtx(req), req.body)));
exports.setCurrentSession = asyncHandler(async (req, res) => ok(res, await settings.setCurrent(...actorCtx(req), req.params.id)));

/* ---- monitoring ---- */
exports.overview = asyncHandler(async (req, res) => ok(res, await reports.overview(req.college)));
exports.auditLog = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await reports.auditLog(req.college._id, { ...req.validatedQuery, ...page });
  ok(res, rows, { meta: pageMeta(total, page) });
});
exports.activeAlerts = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await alerts.listActive(req.college._id, page);
  ok(res, rows, { meta: pageMeta(total, page) });
});

exports.attendanceReport = asyncHandler(async (req, res) => {
  const q = req.validatedQuery;
  const rows = await reports.attendanceReport({
    college: req.college, sectionId: q.sectionId, subjectId: q.subjectId, belowOnly: q.belowThreshold === 'true'
  });
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance-report.csv"');
    return res.send(toCsv([
      { label: 'Roll No', value: 'rollNo' }, { label: 'Name', value: 'name' }, { label: 'Section', value: 'section' },
      { label: 'Subject', value: 'subject' }, { label: 'Attended', value: 'attended' }, { label: 'Eligible classes', value: 'eligible' },
      { label: 'Missed', value: 'missed' }, { label: 'Duty leave exempt', value: 'exempt' },
      { label: 'Percentage', value: r => (r.percentage === null ? '' : r.percentage) }, { label: 'Status', value: 'status' }
    ], rows));
  }
  ok(res, rows);
});
