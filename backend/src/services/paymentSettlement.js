const { Payment, FeeAssignment, StudentProfile } = require('../models');
const { PAYMENT_STATUS: P, NOTIFICATION_TYPES } = require('../config/constants');
const { badRequest, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { outstandingPaise } = require('../utils/feeMath');
const receipts = require('./receiptService');
const notifications = require('./notificationService');
const audit = require('./auditService');
const live = require('./liveService');
const logger = require('../utils/logger');

/**
 * Settlement: everything that turns a gateway result into financial state.
 * Each step is idempotent, so the browser callback, the webhook and the reconciliation job
 * can all run it for the same payment, in any order or concurrently, without double crediting.
 */
const STALE_ORDER_MS = 30 * 60 * 1000;  // an unpaid order older than this is considered abandoned
const event = (type, detail) => ({ at: new Date(), type, ...(detail ? { detail } : {}) });

/**
 * Tells the student's open pages that a payment changed. The event only carries ids: the page then
 * re-reads the verified record through the normal API, so a live event can never mark anything paid.
 */
async function announce(payment) {
  try {
    const profile = await StudentProfile.findById(payment.student).select('user').lean();
    if (profile) await live.publish(profile.user, 'payment.updated', { paymentId: String(payment._id), status: payment.status });
  } catch (err) {
    logger.warn('live payment event failed', { error: err.message });
  }
}

/** Adds a verified payment to the fee assignment's paid total, exactly once. */
async function applyToAssignment(payment) {
  if (payment.applied) return payment;
  const updated = await FeeAssignment.findOneAndUpdate(
    {
      _id: payment.assignment, appliedPayments: { $ne: payment._id },
      // never collect more than is payable
      $expr: { $lte: [{ $add: ['$paidPaise', payment.amountPaise] }, '$totalPayablePaise'] }
    },
    { $inc: { paidPaise: payment.amountPaise }, $push: { appliedPayments: payment._id } },
    { returnDocument: 'after' }
  );

  if (updated) {
    await Payment.updateOne({ _id: payment._id }, { $set: { applied: true, needsReview: false, balanceAfterPaise: outstandingPaise(updated) } });
  } else {
    const already = await FeeAssignment.findOne({ _id: payment.assignment, appliedPayments: payment._id });
    if (already) {
      // applied earlier (e.g. a crash before the flag was set, or a concurrent finalizer)
      await Payment.updateOne({ _id: payment._id, applied: false }, { $set: { applied: true, balanceAfterPaise: outstandingPaise(already) } });
    } else {
      // Verified money that no longer fits the balance (e.g. a concurrent payment): flag for an administrator.
      await Payment.updateOne({ _id: payment._id, needsReview: false }, { $set: { needsReview: true }, $push: { events: event('needs_review', 'Verified amount exceeds the outstanding balance') } });
    }
  }
  return Payment.findById(payment._id);
}

/**
 * Marks a payment successful and applies it. Every step is idempotent, so the browser
 * callback, the webhook and the reconciliation job may all call this for the same payment,
 * in any order or concurrently, and the student is still credited exactly once.
 */
async function finalizeSuccess(paymentId, providerPaymentId, source) {
  let payment;
  try {
    payment = await Payment.findOneAndUpdate(
      { _id: paymentId, status: { $ne: P.SUCCESS } },
      { $set: { status: P.SUCCESS, providerPaymentId, paidAt: new Date(), failureReason: '' }, $push: { events: event('verified', { source }) } },
      { returnDocument: 'after' }
    );
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('PAYMENT_ALREADY_USED', 'That gateway payment is already linked to another transaction.');
    throw err;
  }
  const first = Boolean(payment);
  payment = payment || await Payment.findById(paymentId);

  payment = await applyToAssignment(payment);
  if (payment.applied) {
    await receipts.ensureReceipt(payment);
    payment = await Payment.findById(paymentId);
  }

  if (first) {
    await announce(payment);
    await audit.record({ collegeId: payment.college, action: 'payment.success', entityType: 'Payment', entityId: payment._id, meta: { amountPaise: payment.amountPaise, source, simulated: payment.simulated, needsReview: payment.needsReview } });
    const profile = await StudentProfile.findById(payment.student).select('user');
    await notifications.notify({
      collegeId: payment.college, userId: profile.user, type: NOTIFICATION_TYPES.PAYMENT, title: 'Payment received',
      message: `Your fee payment was verified${payment.receiptNo ? `. Receipt ${payment.receiptNo} is available in Payment History.` : '. A receipt will follow once the payment is reconciled.'}`,
      data: { paymentId: String(payment._id) }, dedupeKey: `payment:${payment._id}:success`
    });
  }
  return payment;
}

async function closeUnpaid(paymentId, status, reason, source) {
  const closed = await Payment.findOneAndUpdate(
    { _id: paymentId, status: { $in: [P.CREATED, P.PENDING] } },
    { $set: { status, failureReason: reason }, $push: { events: event(status, { source, reason }) } },
    { returnDocument: 'after' }
  );
  if (closed) await announce(closed);
  return closed;
}

/** Applies a provider-reported payment status to our record. */
async function settle(payment, remote, source) {
  if (remote.orderId !== payment.providerOrderId || remote.amountPaise !== payment.amountPaise || remote.currency !== payment.currency) {
    await Payment.updateOne({ _id: payment._id }, { $push: { events: event('mismatch', { remote }) } });
    throw badRequest('The gateway payment does not match this order.', undefined, 'PAYMENT_MISMATCH');
  }
  if (remote.status === 'captured') return finalizeSuccess(payment._id, remote.id, source);
  if (remote.status === 'failed') return (await closeUnpaid(payment._id, P.FAILED, remote.failureReason || 'Payment failed', source)) || Payment.findById(payment._id);
  // authorized / created: not money yet
  return (await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: [P.CREATED, P.PENDING] } },
    { $set: { status: P.PENDING }, $push: { events: event('pending', { source, status: remote.status }) } },
    { returnDocument: 'after' }
  )) || Payment.findById(payment._id);
}

module.exports = { STALE_ORDER_MS, event, announce, applyToAssignment, finalizeSuccess, closeUnpaid, settle };
