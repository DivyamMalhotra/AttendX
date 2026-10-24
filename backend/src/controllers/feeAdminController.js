const structures = require('../services/feeStructureService');
const assignments = require('../services/feeAssignmentService');
const feeReports = require('../services/feeReportService');
const receipts = require('../services/receiptService');
const { renderReceipt } = require('../templates/receiptPdf');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, pageMeta } = require('../utils/pagination');
const { toCsv } = require('../utils/csv');
const { formatINR } = require('../utils/money');

const ctx = req => [req.user, req.college._id];
const rupees = paise => (paise / 100).toFixed(2);
const sendCsv = (res, name, csv) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(csv);
};

exports.listStructures = asyncHandler(async (req, res) => res.json({ data: await structures.list(req.college._id) }));
exports.createStructure = asyncHandler(async (req, res) => {
  const { academicSessionId, ...rest } = req.body;
  res.status(201).json({ data: await structures.create(...ctx(req), { ...rest, academicSessionId }) });
});
exports.updateStructure = asyncHandler(async (req, res) => res.json({ data: await structures.update(...ctx(req), req.params.id, req.body) }));
exports.deleteStructure = asyncHandler(async (req, res) => { await structures.remove(...ctx(req), req.params.id); res.json({ data: { ok: true } }); });

exports.assign = asyncHandler(async (req, res) =>
  res.status(201).json({ data: await assignments.assign({ actor: req.user, college: req.college, ...req.body }) }));
exports.adjust = asyncHandler(async (req, res) =>
  res.json({ data: await assignments.adjust({ actor: req.user, college: req.college, assignmentId: req.params.id, ...req.body }) }));

exports.listAssignments = asyncHandler(async (req, res) => {
  const page = parsePagination(req.validatedQuery);
  const { total, rows } = await assignments.listAssignments({ college: req.college, ...req.validatedQuery, ...page });
  res.json({ data: rows, meta: pageMeta(total, page) });
});

exports.summary = asyncHandler(async (req, res) => res.json({ data: await feeReports.collectionSummary(req.college) }));

exports.listTransactions = asyncHandler(async (req, res) => {
  const q = req.validatedQuery;
  if (q.format === 'csv') {
    const { rows } = await feeReports.listTransactions({ college: req.college, ...q, skip: 0, limit: 5000 });
    return sendCsv(res, 'transactions.csv', toCsv([
      { label: 'Transaction ID', value: r => String(r._id) }, { label: 'Date', value: r => r.createdAt.toISOString() },
      { label: 'Roll No', value: 'rollNoSnapshot' }, { label: 'Student', value: r => r.student?.user?.name },
      { label: 'Session', value: r => r.academicSession?.name }, { label: 'Semester', value: 'semesterNumber' },
      { label: 'Amount (INR)', value: r => rupees(r.amountPaise) }, { label: 'Status', value: 'status' },
      { label: 'Gateway order', value: 'providerOrderId' }, { label: 'Gateway payment', value: 'providerPaymentId' },
      { label: 'Receipt', value: 'receiptNo' }, { label: 'Simulated', value: r => (r.simulated ? 'yes' : 'no') }
    ], rows));
  }
  const page = parsePagination(q);
  const { total, rows } = await feeReports.listTransactions({ college: req.college, ...q, ...page });
  res.json({ data: rows, meta: pageMeta(total, page) });
});

exports.transaction = asyncHandler(async (req, res) => res.json({ data: await feeReports.transactionDetail(req.college, req.params.id) }));
exports.reconcile = asyncHandler(async (req, res) =>
  res.json({ data: await feeReports.reconcileTransaction({ actor: req.user, college: req.college, id: req.params.id }) }));

exports.outstanding = asyncHandler(async (req, res) => {
  const rows = await feeReports.outstandingReport({ college: req.college, ...req.validatedQuery });
  if (req.validatedQuery.format === 'csv') {
    return sendCsv(res, 'outstanding-fees.csv', toCsv([
      { label: 'Roll No', value: r => r.student?.rollNo }, { label: 'Student', value: r => r.student?.user?.name },
      { label: 'Section', value: r => r.student?.section?.name }, { label: 'Session', value: r => r.academicSession?.name },
      { label: 'Semester', value: 'semesterNumber' }, { label: 'Payable (INR)', value: r => rupees(r.totalPayablePaise) },
      { label: 'Paid (INR)', value: r => rupees(r.paidPaise) }, { label: 'Outstanding (INR)', value: r => rupees(r.totalPayablePaise - r.paidPaise) },
      { label: 'Due date', value: 'dueDate' }
    ], rows));
  }
  res.json({ data: rows.map(r => ({ ...r, outstandingLabel: formatINR(r.totalPayablePaise - r.paidPaise) })) });
});

exports.receiptPdf = asyncHandler(async (req, res) => {
  const receipt = await receipts.getForViewer({ actor: req.user, college: req.college, receiptId: req.params.id });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.receiptNo}.pdf"`);
  res.send(await renderReceipt(receipt));
});
