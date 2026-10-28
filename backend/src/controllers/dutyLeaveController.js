const fs = require('fs');
const dutyLeave = require('../services/dutyLeaveService');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/errors');
const { parsePagination, pageMeta } = require('../utils/pagination');
const { resolveStored } = require('../middleware/upload');

const KIND = 'duty-leave';

const present = r => ({
  id: String(r._id), fromDate: r.fromDate, toDate: r.toDate, reason: r.reason, status: r.status, remark: r.remark,
  reviewedAt: r.reviewedAt, createdAt: r.createdAt, hasDocument: Boolean(r.document && r.document.storedName),
  documentName: r.document && r.document.originalName, mentor: r.mentor && r.mentor.name,
  leaveType: r.leaveType && r.leaveType.name ? { name: r.leaveType.name, key: r.leaveType.key, sensitive: r.leaveType.sensitive } : { name: 'Duty leave', key: 'duty', sensitive: false },
  history: (r.history || []).map(h => ({ status: h.status, at: h.at, remark: h.remark })),
  ...(r.student && r.student.rollNo ? {
    student: { id: String(r.student._id), rollNo: r.student.rollNo, name: r.student.user && r.student.user.name, section: r.student.section }
  } : {})
});

/* ---- student side ---- */
exports.mine = asyncHandler(async (req, res) => res.json({ data: (await dutyLeave.listForStudent(req.student)).map(present) }));

exports.create = asyncHandler(async (req, res) => {
  const request = await dutyLeave.submit({ actor: req.user, college: req.college, profile: req.student, file: req.file, ...req.body });
  res.status(201).json({ data: present(request) });
});

exports.cancel = asyncHandler(async (req, res) => {
  const request = await dutyLeave.cancel({ actor: req.user, college: req.college, profile: req.student, requestId: req.params.requestId });
  res.json({ data: present(request) });
});

/* ---- reviewer side (the assigned mentor) ---- */
exports.unassigned = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery || {});
  const { total, rows } = await dutyLeave.listUnassigned({ college: req.college, ...page });
  res.json({ data: rows.map(present), meta: pageMeta(total, page) });
});

exports.queue = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await dutyLeave.listForReviewer({ actor: req.user, perms: req.perms, college: req.college, status: req.validatedQuery.status, ...page });
  res.json({ data: rows.map(present), meta: pageMeta(total, page) });
});

exports.review = asyncHandler(async (req, res) => {
  const request = await dutyLeave.review({ actor: req.user, perms: req.perms, college: req.college, requestId: req.params.requestId, ...req.body });
  res.json({ data: present(request) });
});

/* ---- supporting document (owner or the assigned mentor only) ---- */
exports.document = asyncHandler(async (req, res) => {
  const request = await dutyLeave.getForViewer({ actor: req.user, perms: req.perms, college: req.college, requestId: req.params.requestId });
  if (!request.document || !request.document.storedName) throw notFound('No document was attached.');
  const file = resolveStored(KIND, request.document.storedName);
  if (!fs.existsSync(file)) throw notFound('The document is no longer available.');
  res.setHeader('Content-Type', request.document.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="duty-leave-document${require('path').extname(file)}"`);
  fs.createReadStream(file).pipe(res);
});
