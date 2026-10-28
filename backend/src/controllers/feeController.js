const feeView = require('../services/feeViewService');
const payments = require('../services/paymentService');
const receipts = require('../services/receiptService');
const { getProvider, isConfigured } = require('../services/payments');
const { renderReceipt } = require('../templates/receiptPdf');
const { FeeAssignment, Payment } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const { notFound, forbidden } = require('../utils/errors');
const { config } = require('../config/env');

const presentPayment = p => ({
  id: String(p._id), orderId: p.providerOrderId, paymentId: p.providerPaymentId || null, amountPaise: p.amountPaise,
  status: p.status, simulated: p.simulated, receiptNo: p.receiptNo, needsReview: p.needsReview, failureReason: p.failureReason,
  paidAt: p.paidAt, balanceAfterPaise: p.balanceAfterPaise
});

/** A student's own payment by gateway order id; anything else is reported as not found. */
async function ownPayment(req) {
  const payment = await Payment.findOne({ providerOrderId: req.params.orderId, student: req.student._id });
  if (!payment) throw notFound('Payment not found.');
  return payment;
}

exports.summary = asyncHandler(async (req, res) => {
  const data = await feeView.studentSummary({ college: req.college, profile: req.student });
  data.student.name = (req.studentUser || req.user).name;
  data.payments = { configured: isConfigured(), provider: config.payments.provider, simulated: config.payments.provider === 'simulator' };
  res.json({ data });
});

exports.assignment = asyncHandler(async (req, res) => {
  const assignment = await FeeAssignment.findOne({ _id: req.params.id, student: req.student._id }).lean();
  if (!assignment) throw notFound('Fee record not found.');
  res.json({ data: assignment });
});

exports.createOrder = asyncHandler(async (req, res) => {
  const { payment, checkout } = await payments.createOrder({
    college: req.college, profile: req.student, assignmentId: req.body.assignmentId, amountPaise: req.body.amountPaise
  });
  res.status(201).json({ data: {
    payment: presentPayment(payment),
    checkout: { ...checkout, prefill: { name: req.user.name, email: req.user.email } }
  } });
});

exports.verify = asyncHandler(async (req, res) => {
  const payment = await payments.verify({ profile: req.student, orderId: req.params.orderId, ...req.body });
  res.json({ data: presentPayment(payment) });
});

exports.sync = asyncHandler(async (req, res) => {
  res.json({ data: presentPayment(await payments.reconcile(await ownPayment(req), 'student')) });
});

exports.cancel = asyncHandler(async (req, res) => {
  res.json({ data: presentPayment(await payments.cancel({ profile: req.student, orderId: req.params.orderId })) });
});

/** Development/test only: stands in for the customer finishing checkout at the simulator gateway. */
exports.simulatorPay = asyncHandler(async (req, res) => {
  const provider = getProvider();
  if (!provider.simulated || config.isProd) throw forbidden('The payment simulator is not available.');
  await ownPayment(req);
  res.json({ data: provider.simulatePay(req.params.orderId, req.body.outcome) });
});

exports.history = asyncHandler(async (req, res) => {
  const [transactions, summary] = await Promise.all([
    feeView.studentHistory({ college: req.college, profile: req.student }),
    feeView.studentSummary({ college: req.college, profile: req.student })
  ]);
  res.json({ data: { transactions, semesters: summary.semesters, totals: summary.totals } });
});

exports.receiptPdf = asyncHandler(async (req, res) => {
  const receipt = await receipts.getForViewer({ actor: req.user, college: req.college, receiptId: req.params.receiptId, linkedStudentId: req.student && req.student._id });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.receiptNo}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(await renderReceipt(receipt));
});
