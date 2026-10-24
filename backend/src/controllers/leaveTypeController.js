const types = require('../services/leaveTypeService');
const asyncHandler = require('../utils/asyncHandler');

exports.list = asyncHandler(async (req, res) => res.json({ data: await types.list(req.college._id) }));
exports.create = asyncHandler(async (req, res) => res.status(201).json({ data: await types.save(req.user, req.college._id, null, req.body) }));
exports.update = asyncHandler(async (req, res) => res.json({ data: await types.save(req.user, req.college._id, req.params.id, req.body) }));
/** Active types a student can choose from (the internal flags that matter to the form only). */
exports.forStudent = asyncHandler(async (req, res) => {
  const rows = await types.list(req.college._id, { activeOnly: true });
  res.json({ data: rows.map(t => ({ id: String(t._id), key: t.key, name: t.name, description: t.description, requiresDocument: t.requiresDocument, maxDaysPerRequest: t.maxDaysPerRequest })) });
});
