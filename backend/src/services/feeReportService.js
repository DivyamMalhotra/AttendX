const { Payment, FeeAssignment, StudentProfile, Receipt } = require('../models');
const { escapeRegex } = require('../utils/pagination');
const { notFound } = require('../utils/errors');
const paymentService = require('./paymentService');
const audit = require('./auditService');

/** Administrator transaction search: filter by status, date range, roll number or order/payment id. */
async function listTransactions({ college, status, from, to, q, needsReview, skip = 0, limit = 50 }) {
  const filter = { college: college._id };
  if (status) filter.status = status;
  if (needsReview === 'true') filter.needsReview = true;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00+05:30`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999+05:30`);
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = [{ rollNoSnapshot: new RegExp(escapeRegex(q.toUpperCase().replace(/\s+/g, ''))) }, { providerOrderId: rx }, { providerPaymentId: rx }, { receiptNo: rx }];
  }
  const [total, rows] = await Promise.all([
    Payment.countDocuments(filter),
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'student', select: 'user', populate: { path: 'user', select: 'name' } })
      .populate('academicSession', 'name').lean()
  ]);
  return { total, rows };
}

async function transactionDetail(college, id) {
  const payment = await Payment.findOne({ _id: id, college: college._id })
    .populate({ path: 'student', select: 'user rollNo', populate: { path: 'user', select: 'name email' } })
    .populate('academicSession', 'name').lean();
  if (!payment) throw notFound('Transaction not found.');
  const receipt = await Receipt.findOne({ payment: payment._id }).select('_id receiptNo').lean();
  return { ...payment, receiptId: receipt ? String(receipt._id) : null };
}

/**
 * Administrators cannot mark a payment successful by hand. The only path to success is
 * asking the gateway what happened (reconcile), which verifies status and amount.
 */
async function reconcileTransaction({ actor, college, id }) {
  const payment = await Payment.findOne({ _id: id, college: college._id });
  if (!payment) throw notFound('Transaction not found.');
  const result = await paymentService.reconcile(payment, 'admin');
  await audit.record({ actor, collegeId: college._id, action: 'payment.reconcile_requested', entityType: 'Payment', entityId: id, meta: { resultingStatus: result.status } });
  return result;
}

/** Outstanding balances per student for a session/semester, optionally one section. */
async function outstandingReport({ college, sessionId, semesterNumber, sectionId }) {
  const filter = { college: college._id, $expr: { $gt: ['$totalPayablePaise', '$paidPaise'] } };
  if (sessionId) filter.academicSession = sessionId;
  if (semesterNumber) filter.semesterNumber = semesterNumber;
  if (sectionId) {
    filter.student = { $in: (await StudentProfile.find({ college: college._id, section: sectionId }).select('_id').lean()).map(s => s._id) };
  }
  const rows = await FeeAssignment.find(filter)
    .populate({ path: 'student', select: 'rollNo user section', populate: [{ path: 'user', select: 'name' }, { path: 'section', select: 'name sem' }] })
    .populate('academicSession', 'name').sort({ dueDate: 1 }).limit(5000).lean();
  return rows;
}

async function collectionSummary(college) {
  const [byStatus, outstanding] = await Promise.all([
    Payment.aggregate([{ $match: { college: college._id } }, { $group: { _id: '$status', n: { $sum: 1 }, amountPaise: { $sum: '$amountPaise' } } }]),
    FeeAssignment.aggregate([{ $match: { college: college._id } }, { $group: { _id: null, payable: { $sum: '$totalPayablePaise' }, paid: { $sum: '$paidPaise' } } }])
  ]);
  const totals = outstanding[0] || { payable: 0, paid: 0 };
  return {
    byStatus: Object.fromEntries(byStatus.map(s => [s._id, { count: s.n, amountPaise: s.amountPaise }])),
    payablePaise: totals.payable, collectedPaise: totals.paid, outstandingPaise: Math.max(0, totals.payable - totals.paid),
    needsReview: await Payment.countDocuments({ college: college._id, needsReview: true })
  };
}

module.exports = { listTransactions, transactionDetail, reconcileTransaction, outstandingReport, collectionSummary };
