const exams = require('../services/examService');
const results = require('../services/resultService');
const { renderReportCard } = require('../templates/reportCardPdf');
const { allowedSectionIds } = require('../services/permissionService');
const { StudentProfile } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const { forbidden, notFound } = require('../utils/errors');

const ok = (res, data) => res.json({ data });
const ctx = req => ({ actor: req.user, perms: req.perms, college: req.college });
const scope = req => allowedSectionIds(req, 'exams.configure');

/* ---- administration (exam cell) ---- */
exports.policy = asyncHandler(async (req, res) => ok(res, await exams.getPolicy(req.college._id)));
exports.savePolicy = asyncHandler(async (req, res) => ok(res, await exams.savePolicy(req.user, req.college._id, req.body)));
exports.list = asyncHandler(async (req, res) => {
  const sectionIds = await allowedSectionIds(req, req.perms.can('exams.configure') ? 'exams.configure' : 'results.view');
  ok(res, await exams.list(req.college._id, { sectionIds, ...req.validatedQuery }));
});
exports.create = asyncHandler(async (req, res) => res.status(201).json({ data: await exams.create(req.user, req.college, await scope(req), req.body) }));
exports.update = asyncHandler(async (req, res) => ok(res, await exams.update(req.user, req.college, await scope(req), req.params.id, req.body)));
exports.remove = asyncHandler(async (req, res) => { await exams.remove(req.user, req.college, await scope(req), req.params.id); ok(res, { ok: true }); });
exports.review = asyncHandler(async (req, res) => ok(res, await exams.review({ ...ctx(req), id: req.params.id, ...req.body })));
exports.lock = asyncHandler(async (req, res) => ok(res, await exams.lock({ ...ctx(req), id: req.params.id })));
exports.publish = asyncHandler(async (req, res) => ok(res, await exams.publish({ ...ctx(req), id: req.params.id })));
exports.reopen = asyncHandler(async (req, res) => ok(res, await exams.reopen({ ...ctx(req), id: req.params.id, reason: req.body.reason })));
exports.sheet = asyncHandler(async (req, res) => ok(res, await exams.marksSheet({ ...ctx(req), id: req.params.id })));

/* ---- faculty ---- */
exports.facultyList = asyncHandler(async (req, res) => ok(res, await exams.list(req.college._id, { teacherId: req.user._id })));
exports.saveMarks = asyncHandler(async (req, res) => ok(res, await exams.saveMarks({ ...ctx(req), id: req.params.id, entries: req.body.entries, reason: req.body.reason })));
exports.submit = asyncHandler(async (req, res) => ok(res, await exams.submit({ ...ctx(req), id: req.params.id })));

/* ---- students and report cards ---- */
exports.myResults = asyncHandler(async (req, res) => ok(res, await results.forStudent(req.student._id)));

async function sendReportCard(req, res, studentId) {
  const data = await results.reportCardData({ studentId, ...req.validatedQuery });
  if (!data) throw notFound('No published results for that semester.');
  const pdf = await renderReportCard({ college: req.college, data });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-card-${data.profile.rollNo}-sem${data.semester.semesterNumber}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(pdf);
}
exports.myReportCard = asyncHandler(async (req, res) => sendReportCard(req, res, req.student._id));

exports.adminReportCard = asyncHandler(async (req, res) => {
  const profile = await StudentProfile.findOne({ _id: req.params.studentId, college: req.college._id }).select('section').lean();
  if (!profile) throw notFound('Student not found.');
  const sectionIds = await allowedSectionIds(req, 'results.view');
  if (sectionIds && !sectionIds.some(s => String(s) === String(profile.section))) throw forbidden('That student is outside your department.', 'OUT_OF_SCOPE');
  await sendReportCard(req, res, req.params.studentId);
});

/** Lets the examination cell confirm that a printed report card is genuine. */
exports.verify = asyncHandler(async (req, res) => {
  const { studentId, sessionId, semesterNumber, code } = req.validatedQuery;
  const profile = await StudentProfile.findOne({ _id: studentId, college: req.college._id }).select('_id').lean();
  const data = profile && await results.reportCardData({ studentId, sessionId, semesterNumber });
  ok(res, { genuine: Boolean(data) && data.code === code.toUpperCase() });
});
