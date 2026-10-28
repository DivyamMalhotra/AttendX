const mentors = require('../services/mentorService');
const parents = require('../services/parentService');
const timeline = require('../services/timelineService');
const asyncHandler = require('../utils/asyncHandler');

const ok = (res, data) => res.json({ data });
const created = (res, data) => res.status(201).json({ data });
const ctx = req => ({ actor: req.user, perms: req.perms, college: req.college });

/* ---- administration ---- */
exports.assign = asyncHandler(async (req, res) => created(res, await mentors.assign({ actor: req.user, college: req.college, ...req.body })));
exports.assignments = asyncHandler(async (req, res) => ok(res, await mentors.listAssignments({ collegeId: req.college._id })));
exports.history = asyncHandler(async (req, res) => ok(res, await mentors.history(req.params.studentId)));


exports.parentCreate = asyncHandler(async (req, res) => {
  const { user, link } = await parents.createParent({ actor: req.user, college: req.college, input: req.body });
  created(res, { user: user.toPublic(), linkId: String(link._id) });
});
exports.parentLink = asyncHandler(async (req, res) => created(res, await parents.createLink({ actor: req.user, college: req.college, ...req.body })));
exports.parentRevoke = asyncHandler(async (req, res) => ok(res, await parents.revoke({ actor: req.user, college: req.college, id: req.params.id, reason: req.body.reason })));
exports.parentList = asyncHandler(async (req, res) => ok(res, await parents.list({ collegeId: req.college._id, studentId: req.validatedQuery.studentId })));

/* ---- mentor workspace ---- */
exports.mentees = asyncHandler(async (req, res) => ok(res, await mentors.listAssignments({ collegeId: req.college._id, mentorId: req.user._id })));
exports.overview = asyncHandler(async (req, res) => ok(res, await mentors.overview({ ...ctx(req), studentId: req.params.studentId })));
exports.notes = asyncHandler(async (req, res) => ok(res, await mentors.listNotes({ ...ctx(req), studentId: req.params.studentId })));
exports.addNote = asyncHandler(async (req, res) => created(res, await mentors.addNote({ ...ctx(req), studentId: req.params.studentId, input: req.body })));
exports.updateNote = asyncHandler(async (req, res) => ok(res, await mentors.updateNote({ ...ctx(req), id: req.params.id, input: req.body })));
exports.attendanceWatch = asyncHandler(async (req, res) => ok(res, await mentors.attendanceWatch({ actor: req.user, college: req.college })));
exports.followUps = asyncHandler(async (req, res) => ok(res, await mentors.followUps(ctx(req))));
exports.timeline = asyncHandler(async (req, res) => {
  const profile = await mentors.assertAccess({ ...ctx(req), studentId: req.params.studentId });
  ok(res, await timeline.forStudent({ college: req.college, profile, ...req.validatedQuery, viewer: 'staff' }));
});

