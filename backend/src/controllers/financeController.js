const refunds = require('../services/refundService');
const lateFees = require('../services/lateFeeService');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, pageMeta } = require('../utils/pagination');

const ok = (res, data, extra) => res.json({ data, ...(extra || {}) });
const base = req => ({ actor: req.user, college: req.college });

/* ---- refunds ---- */
exports.listRefunds = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await refunds.list({ college: req.college, ...req.validatedQuery, ...page });
  ok(res, rows, { meta: pageMeta(total, page) });
});
exports.requestRefund = asyncHandler(async (req, res) => res.status(201).json({ data: await refunds.request({ ...base(req), ...req.body }) }));
exports.approveRefund = asyncHandler(async (req, res) => ok(res, await refunds.approve({ ...base(req), id: req.params.id, note: req.body.note })));
exports.rejectRefund = asyncHandler(async (req, res) => ok(res, await refunds.reject({ ...base(req), id: req.params.id, note: req.body.note })));
exports.retryRefund = asyncHandler(async (req, res) => ok(res, await refunds.retry({ ...base(req), id: req.params.id })));
exports.myRefunds = asyncHandler(async (req, res) => ok(res, await refunds.forStudent(req.student._id)));

/* ---- late fees ---- */
exports.getPolicy = asyncHandler(async (req, res) => ok(res, (await lateFees.getPolicy(req.college._id)) || { active: false }));
exports.savePolicy = asyncHandler(async (req, res) => ok(res, await lateFees.savePolicy({ ...base(req), input: req.body })));
exports.listLateFees = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await lateFees.list({ college: req.college, ...req.validatedQuery, ...page });
  ok(res, rows, { meta: pageMeta(total, page) });
});
exports.waiveLateFee = asyncHandler(async (req, res) => ok(res, await lateFees.waive({ ...base(req), id: req.params.id, reason: req.body.reason })));
exports.runLateFees = asyncHandler(async (req, res) => ok(res, await lateFees.assessCollege(req.college)));
