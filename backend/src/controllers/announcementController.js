const svc = require('../services/announcementService');
const asyncHandler = require('../utils/asyncHandler');

const ok = (res, data) => res.json({ data });

exports.feed = asyncHandler(async (req, res) => ok(res, await svc.feed({ college: req.college, user: req.user, unreadOnly: req.validatedQuery.unread === 'true' })));
exports.read = asyncHandler(async (req, res) => { await svc.markRead({ college: req.college, user: req.user, id: req.params.id }); ok(res, { ok: true }); });
exports.manage = asyncHandler(async (req, res) => ok(res, await svc.manageList({ req })));
exports.create = asyncHandler(async (req, res) => res.status(201).json({ data: await svc.create({ req, input: req.body, files: req.files }) }));
exports.update = asyncHandler(async (req, res) => ok(res, await svc.update({ req, id: req.params.id, input: req.body })));
exports.publish = asyncHandler(async (req, res) => ok(res, await svc.publish({ req, id: req.params.id })));
exports.withdraw = asyncHandler(async (req, res) => ok(res, await svc.withdraw({ req, id: req.params.id })));
exports.stats = asyncHandler(async (req, res) => ok(res, await svc.stats({ req, id: req.params.id })));
