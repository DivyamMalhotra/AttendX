const timetables = require('../services/timetableService');
const lifecycle = require('../services/sessionLifecycleService');
const { allowedSectionIds } = require('../services/permissionService');
const { Timetable, TimetableEntry } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const { forbidden } = require('../utils/errors');
const { todayISO, addDays } = require('../utils/dates');

const ok = (res, data) => res.json({ data });
const scope = req => allowedSectionIds(req, 'timetable.manage');

exports.list = asyncHandler(async (req, res) => {
  const sectionIds = await allowedSectionIds(req, req.perms.can('timetable.manage') ? 'timetable.manage' : 'timetable.view');
  ok(res, await timetables.list(req.college._id, { sectionIds, sectionId: req.validatedQuery.sectionId }));
});
exports.create = asyncHandler(async (req, res) => res.status(201).json({ data: await timetables.createDraft(req.user, req.college, await scope(req), req.body) }));
exports.detail = asyncHandler(async (req, res) => ok(res, await timetables.detail(req.college._id, req.params.id)));
exports.addEntry = asyncHandler(async (req, res) => res.status(201).json({ data: await timetables.addEntry(req.user, req.college, req.params.id, req.body) }));
exports.removeEntry = asyncHandler(async (req, res) => { await timetables.removeEntry(req.user, req.college, req.params.id, req.params.entryId); ok(res, { ok: true }); });
exports.approve = asyncHandler(async (req, res) => ok(res, await timetables.approve(req.user, req.college, req.params.id)));
exports.generate = asyncHandler(async (req, res) => ok(res, await timetables.generate(req.college._id, req.body.from, req.body.to)));

/** A faculty member's weekly schedule across approved timetables. */
exports.mine = asyncHandler(async (req, res) => {
  const today = todayISO(req.college.settings.timezone);
  const live = await Timetable.find({ college: req.college._id, status: { $in: ['approved', 'archived'] }, effectiveFrom: { $lte: addDays(today, 7) } }).lean();
  const current = live.filter(t => !t.effectiveTo || t.effectiveTo >= today);
  const entries = await TimetableEntry.find({ timetable: { $in: current.map(t => t._id) }, teacher: req.user._id })
    .populate('subject', 'name code').populate('section', 'name sem').sort({ dayOfWeek: 1, startTime: 1 }).lean();
  ok(res, entries);
});

exports.unmarked = asyncHandler(async (req, res) => {
  const sectionIds = await allowedSectionIds(req, 'attendance.view');
  const teacherOnly = !req.perms.can('attendance.view');
  ok(res, await lifecycle.listUnmarked({ college: req.college, sectionIds, teacherId: teacherOnly ? req.user._id : undefined }));
});

/* ---- faculty actions on a class session ---- */
exports.today = asyncHandler(async (req, res) => {
  const { date, teacherId } = req.validatedQuery;
  if (teacherId && teacherId !== String(req.user._id) && !req.perms.can('attendance.view')) throw forbidden();   // institution-wide view only
  ok(res, await lifecycle.todaysClasses({ actor: req.user, college: req.college, date, teacherId }));
});
exports.open = asyncHandler(async (req, res) => ok(res, await lifecycle.open({ actor: req.user, perms: req.perms, college: req.college, id: req.params.id })));
exports.cancelSession = asyncHandler(async (req, res) => ok(res, await lifecycle.cancel({ actor: req.user, perms: req.perms, college: req.college, id: req.params.id, reason: req.body.reason })));
exports.resolve = asyncHandler(async (req, res) => ok(res, await lifecycle.resolve({ actor: req.user, perms: req.perms, college: req.college, id: req.params.id, ...req.body })));
