const library = require('../services/libraryService');
const hostel = require('../services/hostelService');
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

/* ---- hostel ---- */
exports.hostels = asyncHandler(async (req, res) => ok(res, await hostel.listHostels(req.college._id)));
exports.saveHostel = asyncHandler(async (req, res) => created(res, await hostel.saveHostel({ ...base(req), input: req.body })));
exports.updateHostel = asyncHandler(async (req, res) => ok(res, await hostel.saveHostel({ ...base(req), id: req.params.id, input: req.body })));
exports.rooms = asyncHandler(async (req, res) => ok(res, await hostel.roomsOf(req.college._id, req.params.id)));
exports.addRooms = asyncHandler(async (req, res) => created(res, await hostel.addRooms({ ...base(req), hostelId: req.params.id, groups: req.body.groups })));
exports.updateRoom = asyncHandler(async (req, res) => ok(res, await hostel.updateRoom({ ...base(req), roomId: req.params.id, input: req.body })));
exports.allocate = asyncHandler(async (req, res) => created(res, await hostel.allocate({ ...base(req), studentRef: req.body.student, roomId: req.body.roomId, from: req.body.from, charge: req.body.charge })));
exports.checkIn = asyncHandler(async (req, res) => ok(res, await hostel.checkIn({ ...base(req), id: req.params.id })));
exports.end = asyncHandler(async (req, res) => ok(res, await hostel.end({ ...base(req), id: req.params.id, reason: req.body.reason })));
exports.transfer = asyncHandler(async (req, res) => ok(res, await hostel.transfer({ ...base(req), id: req.params.id, toRoomId: req.body.toRoomId, reason: req.body.reason })));
exports.allocations = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await hostel.allocations({ college: req.college, ...req.validatedQuery, ...page });
  ok(res, rows, { meta: pageMeta(total, page) });
});
exports.myStay = asyncHandler(async (req, res) => ok(res, await hostel.forStudent(req.student._id)));
