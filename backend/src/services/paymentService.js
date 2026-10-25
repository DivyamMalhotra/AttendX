const { Payment, FeeAssignment } = require('../models');
const { config } = require('../config/env');
const { PAYMENT_STATUS: P } = require('../config/constants');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { outstandingPaise } = require('../utils/feeMath');
const { getProvider } = require('./payments');
const { STALE_ORDER_MS, event, finalizeSuccess, closeUnpaid, settle } = require('./paymentSettlement');
const audit = require('./auditService');

const MIN_PAYMENT_PAISE = 100;          // ₹1

/* ------------------------------------------------------------------ orders */

/**
 * Creates a payment order. The amount is decided here, on the server, from the student's
 * own fee assignment: the browser may only ask for a partial amount, which is validated
 * against the outstanding balance and can never exceed it.
 */
async function createOrder({ college, profile, assignmentId, amountPaise }) {
  const provider = getProvider();
  const assignment = await FeeAssignment.findOne({ _id: assignmentId, student: profile._id, college: college._id });
  if (!assignment) throw notFound('Fee record not found.');

  const outstanding = outstandingPaise(assignment);
  if (outstanding <= 0) throw conflict('ALREADY_PAID', 'This semester fee is already fully paid.');

  const amount = amountPaise ?? outstanding;
  if (!Number.isSafeInteger(amount) || amount < Math.min(MIN_PAYMENT_PAISE, outstanding)) {
    throw badRequest('The payment amount is too small.', undefined, 'AMOUNT_TOO_SMALL');
  }
  if (amount > outstanding) throw badRequest('The amount exceeds the outstanding balance.', undefined, 'EXCEEDS_OUTSTANDING');
  if (!college.settings.allowPartialPayments && amount !== outstanding) {
    throw badRequest('Partial payments are not enabled. Pay the full outstanding amount.', undefined, 'PARTIAL_NOT_ALLOWED');
  }

  // Abandoned checkouts are closed so they stop cluttering history; they are never deleted.
  await Payment.updateMany(
    { assignment: assignment._id, status: P.CREATED, createdAt: { $lt: new Date(Date.now() - STALE_ORDER_MS) } },
    { $set: { status: P.CANCELLED, failureReason: 'Checkout abandoned' }, $push: { events: event('abandoned') } }
  );

  const order = await provider.createOrder({
    amountPaise: amount, currency: config.payments.currency, receipt: `fee_${assignment._id}_${Date.now()}`,
    notes: { student: String(profile._id), rollNo: profile.rollNo, assignment: String(assignment._id) }
  });

  const payment = await Payment.create({
    college: college._id, student: profile._id, rollNoSnapshot: profile.rollNo, assignment: assignment._id,
    academicSession: assignment.academicSession, semesterNumber: assignment.semesterNumber, category: assignment.category || 'semester', amountPaise: amount,
    currency: config.payments.currency, provider: provider.name, simulated: provider.simulated,
    providerOrderId: order.id, status: P.CREATED, events: [event('order_created', { amountPaise: amount })]
  });

  return { payment, checkout: { ...provider.publicConfig(), orderId: order.id, amountPaise: amount, currency: payment.currency } };
}

/* ------------------------------------------------------ student-facing ops */

async function findOwn(profile, orderId) {
  const payment = await Payment.findOne({ providerOrderId: orderId, student: profile._id });
  if (!payment) throw notFound('Payment not found.');
  return payment;
}

/** Called after checkout: verifies the signature, then re-checks the payment with the gateway. */
async function verify({ profile, orderId, paymentId, signature }) {
  const provider = getProvider();
  const payment = await findOwn(profile, orderId);
  if (payment.status === P.SUCCESS) return payment;

  if (!provider.verifyPaymentSignature({ orderId, paymentId, signature })) {
    await Payment.updateOne({ _id: payment._id }, { $push: { events: event('signature_invalid') } });
    await audit.record({ collegeId: payment.college, action: 'payment.signature_invalid', entityType: 'Payment', entityId: payment._id });
    throw badRequest('Payment verification failed.', undefined, 'VERIFICATION_FAILED');
  }
  const remote = await provider.fetchPayment(paymentId);
  return settle(payment, remote, 'checkout');
}

/** Re-reads the order from the gateway; used for pending/failed flows and the reconcile job. */
async function reconcile(payment, source = 'reconcile') {
  if (payment.status === P.SUCCESS && payment.applied && payment.receiptNo) return payment;
  if (payment.status === P.SUCCESS) return finalizeSuccess(payment._id, payment.providerPaymentId, source); // finish a half-applied payment

  const provider = getProvider();
  const attempts = await provider.fetchOrderPayments(payment.providerOrderId);
  const captured = attempts.find(a => a.status === 'captured');
  if (captured) return settle(payment, captured, source);

  const authorized = attempts.find(a => a.status === 'authorized');
  if (authorized) return settle(payment, authorized, source);

  const stale = Date.now() - payment.createdAt.getTime() > STALE_ORDER_MS;
  if (stale) {
    const failed = attempts.length && attempts.every(a => a.status === 'failed');
    return (await closeUnpaid(payment._id, failed ? P.FAILED : P.CANCELLED, failed ? attempts[attempts.length - 1].failureReason || 'Payment failed' : 'Checkout abandoned', source)) || Payment.findById(payment._id);
  }
  const lastFailed = attempts.length && attempts[attempts.length - 1].status === 'failed';
  if (lastFailed) await Payment.updateOne({ _id: payment._id, status: P.CREATED }, { $push: { events: event('attempt_failed', { reason: attempts[attempts.length - 1].failureReason }) } });
  return Payment.findById(payment._id);
}

async function cancel({ profile, orderId }) {
  const payment = await findOwn(profile, orderId);
  const closed = await closeUnpaid(payment._id, P.CANCELLED, 'Cancelled by student', 'student');
  return closed || payment;
}

/* ----------------------------------------------------------------- webhook */

/** Handles a signed provider webhook. Returns a short result string for the HTTP layer. */
async function handleWebhook(rawBody, headers) {
  const provider = getProvider();
  if (!provider.verifyWebhook(rawBody, headers)) return 'invalid_signature';
  let evt;
  try { evt = provider.parseWebhook(rawBody, headers); } catch (e) { return 'bad_payload'; }
  if (!evt) return 'ignored';
  if (evt.kind === 'refund_processed' || evt.kind === 'refund_failed') return require('./refundService').handleProviderEvent(evt);

  const payment = await Payment.findOne({ providerOrderId: evt.orderId });
  if (!payment) return 'unknown_order';

  if (evt.kind === 'success') {
    if (evt.amountPaise !== payment.amountPaise) {
      await Payment.updateOne({ _id: payment._id }, { $push: { events: event('webhook_amount_mismatch', { evt }) } });
      return 'amount_mismatch';
    }
    await finalizeSuccess(payment._id, evt.paymentId, 'webhook');
  } else if (evt.kind === 'failed') {
    await closeUnpaid(payment._id, P.FAILED, evt.reason || 'Payment failed', 'webhook');
  } else {
    await Payment.updateOne({ _id: payment._id, status: P.CREATED }, { $set: { status: P.PENDING }, $push: { events: event('pending', { source: 'webhook' }) } });
  }
  return 'processed';
}

/** Reconciles every open or half-finished payment (used by the background job and admins). */
async function reconcileOpenPayments({ olderThanMs = 2 * 60 * 1000, limit = 100 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const open = await Payment.find({
    $or: [
      { status: { $in: [P.CREATED, P.PENDING] }, createdAt: { $lt: cutoff } },
      { status: P.SUCCESS, applied: false, needsReview: false },
      { status: P.SUCCESS, applied: true, receiptNo: null }
    ]
  }).limit(limit);
  let touched = 0;
  for (const p of open) {
    try { await reconcile(p, 'job'); touched += 1; } catch (e) { /* one bad payment must not stop the batch */ }
  }
  return { checked: open.length, touched };
}

module.exports = { createOrder, verify, reconcile, cancel, handleWebhook, reconcileOpenPayments, MIN_PAYMENT_PAISE };
