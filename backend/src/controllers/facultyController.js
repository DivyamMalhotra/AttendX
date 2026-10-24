const attendance = require('../services/attendanceService');
const stats = require('../services/attendanceStatsService');
const asyncHandler = require('../utils/asyncHandler');

const ok = (res, data) => res.json({ data });

exports.subjects = asyncHandler(async (req, res) =>
  ok(res, await attendance.listMarkableSubjects({ actor: req.user, college: req.college })));

exports.lookup = asyncHandler(async (req, res) => {
  // subject access (teacher assignment) is verified by requireSubjectAccess before this runs
  ok(res, await attendance.lookupSession(req.validatedQuery));
});

exports.submit = asyncHandler(async (req, res) => {
  const { subjectId, date, slot, records, expectNew } = req.body;
  const result = await attendance.submitSession({ actor: req.user, college: req.college, subjectId, date, slot, records, expectNew });
  res.status(result.created ? 201 : 200).json({ data: {
    sessionId: String(result.session._id), created: result.created, counts: result.counts, changedRecords: result.changedRecords
  } });
});

exports.update = asyncHandler(async (req, res) => {
  const session = await attendance.updateSession({ actor: req.user, college: req.college, sessionId: req.params.sessionId, ...req.body });
  ok(res, { sessionId: String(session._id), counts: session.counts });
});

exports.detail = asyncHandler(async (req, res) =>
  ok(res, await attendance.getSessionDetail({ actor: req.user, college: req.college, sessionId: req.params.sessionId })));

exports.students = asyncHandler(async (req, res) => ok(res, await attendance.listEnrolled(req.subject)));

exports.summary = asyncHandler(async (req, res) =>
  ok(res, await stats.subjectSummary(req.subject, req.college.settings)));
