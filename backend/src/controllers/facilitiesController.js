const library = require('../services/libraryService');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, pageMeta } = require('../utils/pagination');

const ok = (res, data, extra = {}) => res.json({ data, ...extra });
const created = (res, data) => res.status(201).json({ data });
const base = req => ({ actor: req.user, college: req.college });

/* ---- library ---- */
exports.books = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await library.listBooks({ college: req.college, ...req.validatedQuery, ...page });
  ok(res, rows, { meta: pageMeta(total, page) });
});
exports.addBook = asyncHandler(async (req, res) => created(res, await library.addBook({ ...base(req), input: req.body })));
exports.addCopies = asyncHandler(async (req, res) => created(res, await library.addMoreCopies({ ...base(req), bookId: req.params.id, count: req.body.count })));
exports.issue = asyncHandler(async (req, res) => created(res, await library.issue({ ...base(req), ...req.body })));
exports.returnBook = asyncHandler(async (req, res) => ok(res, await library.returnBook({ ...base(req), ...req.body })));
exports.lost = asyncHandler(async (req, res) => ok(res, await library.markLost({ ...base(req), issueId: req.params.id })));
exports.loans = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await library.loans({ college: req.college, status: req.validatedQuery.status, overdueOnly: req.validatedQuery.overdue === 'true', ...page });
  ok(res, rows, { meta: pageMeta(total, page) });
});
exports.myLoans = asyncHandler(async (req, res) => ok(res, await library.studentLoans({ college: req.college, profile: req.student })));

