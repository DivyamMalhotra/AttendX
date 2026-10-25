const { Refund, Payment, FeeAssignment, StudentProfile } = require('../models');
const { REFUND_STATUS: S, NOTIFICATION_TYPES } = require('../config/constants');
const { conflict, forbidden, notFound } = require('../utils/errors');
const { getProvider } = require('./payments');
const notifications = require('./notificationService');
const audit = require('./auditService');
const live = require('./liveService');
const logger = require('../utils/logger');

/**
 * Refunds. The workflow is request -> approve (a different person) -> gateway -> completed.
 *
 * Money safety rests on three guards:
 *  - the amount is RESERVED on the payment with one atomic, guarded update when requested, so open requests plus
 *    completed refunds can never exceed what was paid, however many are raised at once;
 *  - the gateway call carries an idempotency key (the refund id), so a retry after a timeout cannot refund twice;
 *  - booking a completed refund onto the payment and the fee is keyed on the refund id (appliedRefunds), so the
 *    webhook, the reconciliation job and a retry can all run it and it is applied exactly once.
 */
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ev = (type, by, detail) => ({ at: new Date(), type, by: by || null, ...(detail !== undefined ? { detail } : {}) });
const payEvent = (type, detail) => ({ at: new Date(), type, detail });

const reserve = (payment, amountPaise, refundId) => Payment.findOneAndUpdate(
  {
    _id: payment._id, status: 'success', applied: true,
    $expr: { $lte: [{ $add: ['$refundReservedPaise', '$refundedPaise', amountPaise] }, '$amountPaise'] }
  },
  { $inc: { refundReservedPaise: amountPaise }, ...(refundId ? { $pull: { releasedRefunds: refundId } } : {}) },
  { returnDocument: 'after' }
);

/** Hands a failed/rejected refund's reservation back. Idempotent: keyed on the refund id. */
async function release(refund) {
  await Payment.updateOne({ _id: refund.payment, releasedRefunds: { $ne: refund._id } },
    { $inc: { refundReservedPaise: -refund.amountPaise }, $push: { releasedRefunds: refund._id } });
  await Refund.updateOne({ _id: refund._id }, { $set: { released: true } });
}

async function tell(refund, title, message) {
  try {
    const profile = await StudentProfile.findById(refund.student).select('user').lean();
    if (!profile) return;
    await notifications.notify({
      collegeId: refund.college, userId: profile.user, type: NOTIFICATION_TYPES.REFUND, title, message,
      data: { refundId: String(refund._id) }, dedupeKey: `refund:${refund._id}:${refund.status}`, link: 'student.html#fees'
    });
    await live.publish(profile.user, 'refund.updated', { refundId: String(refund._id), status: refund.status });
  } catch (err) {
    logger.warn('refund notification failed', { error: err.message });
  }
}

/* ----------------------------------------------------------------- request */

async function request({ actor, college, paymentId, amountPaise, reason, reduceFee = false }) {
  const payment = await Payment.findOne({ _id: paymentId, college: college._id });
  if (!payment) throw notFound('Payment not found.');
  if (payment.status !== 'success' || !payment.applied) throw conflict('NOT_REFUNDABLE', 'Only a verified payment that has been applied to a fee can be refunded.');
  const assignment = await FeeAssignment.findById(payment.assignment).select('paidPaise').lean();
  if (!assignment || assignment.paidPaise < amountPaise) throw conflict('EXCEEDS_PAID', 'The fee has less paid on it than this refund.');

  const reserved = await reserve(payment, amountPaise);
  if (!reserved) {
    const left = Math.max(0, payment.amountPaise - payment.refundedPaise - payment.refundReservedPaise);
    throw conflict('REFUND_EXCEEDS_PAYMENT', `Only ${left / 100} INR of this payment can still be refunded (other refunds may be pending).`);
  }
  try {
    const refund = await Refund.create({
      college: college._id, payment: payment._id, assignment: payment.assignment, student: payment.student, amountPaise, reason, reduceFee,
      requestedBy: actor._id, events: [ev('requested', actor._id, { amountPaise })]
    });
    await audit.record({ actor, collegeId: college._id, action: 'refund.requested', entityType: 'Refund', entityId: refund._id, meta: { payment: String(payment._id), amountPaise } });
    return refund;
  } catch (err) {
    await Payment.updateOne({ _id: payment._id }, { $inc: { refundReservedPaise: -amountPaise } });   // nothing was created: hand it back
    throw err;
  }
}

/* ---------------------------------------------------------------- decisions */

async function explainMiss(college, id, wanted) {
  const r = await Refund.findOne({ _id: id, college: college._id }).select('status').lean();
  if (!r) throw notFound('Refund not found.');
  throw conflict('INVALID_STATE', `This refund is ${r.status}; only ${wanted} refunds can be changed this way.`);
}

/** Approval needs a second person: the requester cannot approve their own refund. */
async function approve({ actor, college, id, note = '' }) {
  const refund = await Refund.findOneAndUpdate(
    { _id: id, college: college._id, status: S.REQUESTED, requestedBy: { $ne: actor._id } },
    { $set: { status: S.APPROVED, decidedBy: actor._id, decidedAt: new Date(), decisionNote: note }, $push: { events: ev('approved', actor._id, note ? { note } : undefined) } },
    { returnDocument: 'after' }
  );
  if (!refund) {
    const own = await Refund.exists({ _id: id, college: college._id, status: S.REQUESTED, requestedBy: actor._id });
    if (own) throw forbidden('A refund must be approved by someone other than the person who requested it.', 'SELF_APPROVAL');
    return explainMiss(college, id, 'requested');
  }
  await audit.record({ actor, collegeId: college._id, action: 'refund.approved', entityType: 'Refund', entityId: refund._id, meta: { amountPaise: refund.amountPaise } });
  return processRefund(refund._id);
}

async function reject({ actor, college, id, note = '' }) {
  const refund = await Refund.findOneAndUpdate(
    { _id: id, college: college._id, status: S.REQUESTED },
    { $set: { status: S.REJECTED, decidedBy: actor._id, decidedAt: new Date(), decisionNote: note }, $push: { events: ev('rejected', actor._id, note ? { note } : undefined) } },
    { returnDocument: 'after' }
  );
  if (!refund) return explainMiss(college, id, 'requested');
  await release(refund);
  await audit.record({ actor, collegeId: college._id, action: 'refund.rejected', entityType: 'Refund', entityId: refund._id, meta: { note } });
  await tell(refund, 'Refund request declined', 'Your refund request was reviewed and declined. Contact the accounts office for details.');
  return refund;
}

/** A refund the gateway rejected can be tried again: the money is re-reserved and the same idempotency key is reused. */
async function retry({ actor, college, id }) {
  const failed = await Refund.findOne({ _id: id, college: college._id, status: S.FAILED });
  if (!failed) return explainMiss(college, id, 'failed');
  const payment = await Payment.findById(failed.payment);
  const reserved = await reserve(payment, failed.amountPaise, failed._id);
  if (!reserved) throw conflict('REFUND_EXCEEDS_PAYMENT', 'The payment no longer has enough un-refunded money for this refund.');
  const refund = await Refund.findOneAndUpdate({ _id: id, status: S.FAILED },
    { $set: { status: S.APPROVED, released: false, failureReason: '', attempts: 0, nextAttemptAt: null }, $push: { events: ev('retry', actor._id) } }, { returnDocument: 'after' });
  if (!refund) { await Payment.updateOne({ _id: payment._id }, { $inc: { refundReservedPaise: -failed.amountPaise } }); return explainMiss(college, id, 'failed'); }
  await audit.record({ actor, collegeId: college._id, action: 'refund.retried', entityType: 'Refund', entityId: id });
  return processRefund(refund._id);
}

/* -------------------------------------------------------------- gateway work */

async function fail(refundId, reason) {
  const refund = await Refund.findOneAndUpdate({ _id: refundId, status: { $in: [S.APPROVED, S.PROCESSING] } },
    { $set: { status: S.FAILED, failureReason: String(reason).slice(0, 300) }, $push: { events: ev('failed', null, { reason }) } }, { returnDocument: 'after' });
  if (!refund) return Refund.findById(refundId);
  await release(refund);
  await audit.record({ collegeId: refund.college, action: 'refund.failed', entityType: 'Refund', entityId: refund._id, meta: { reason } });
  await tell(refund, 'Refund could not be completed', 'Your refund could not be completed and has been sent back to the accounts office.');
  return refund;
}

/** Books a completed refund onto the fee and the payment. Safe to repeat. */
async function applyCompleted(refund) {
  if (refund.applied) return refund;
  const update = { $inc: { paidPaise: -refund.amountPaise, refundedPaise: refund.amountPaise }, $push: { appliedRefunds: refund._id } };
  if (refund.reduceFee) {
    update.$inc.totalPayablePaise = -refund.amountPaise;
    update.$push.adjustments = { kind: 'concession', label: 'Refund adjustment', amountPaise: refund.amountPaise, by: refund.decidedBy, at: new Date() };
  }
  const booked = await FeeAssignment.findOneAndUpdate(
    { _id: refund.assignment, appliedRefunds: { $ne: refund._id }, $expr: { $gte: ['$paidPaise', refund.amountPaise] } }, update, { returnDocument: 'after' });
  if (!booked && !(await FeeAssignment.exists({ _id: refund.assignment, appliedRefunds: refund._id }))) {
    await Refund.updateOne({ _id: refund._id }, { $push: { events: ev('apply_blocked', null, 'The fee has less paid on it than this refund; needs an administrator') } });
    logger.error('completed refund could not be booked', { refund: String(refund._id) });
    return refund;
  }
  await Payment.updateOne({ _id: refund.payment, appliedRefunds: { $ne: refund._id } },
    {
      $inc: { refundReservedPaise: -refund.amountPaise, refundedPaise: refund.amountPaise },
      $push: { appliedRefunds: refund._id, events: payEvent('refund', { refundId: String(refund._id), amountPaise: refund.amountPaise }) }
    });
  const done = await Refund.findOneAndUpdate({ _id: refund._id }, { $set: { applied: true } }, { returnDocument: 'after' });
  await audit.record({ collegeId: refund.college, action: 'refund.completed', entityType: 'Refund', entityId: refund._id, meta: { amountPaise: refund.amountPaise } });
  await tell(done, 'Refund completed', 'Your refund has been processed. It can take a few working days to reach your account.');
  return done;
}

async function complete(refundId, providerRefundId) {
  await Refund.findOneAndUpdate({ _id: refundId, status: S.PROCESSING },
    { $set: { status: S.COMPLETED, ...(providerRefundId ? { providerRefundId } : {}) }, $push: { events: ev('completed') } });
  const refund = await Refund.findById(refundId);
  return refund && refund.status === S.COMPLETED ? applyCompleted(refund) : refund;
}

/**
 * Sends an approved refund to the gateway. Claiming (approved -> processing) is atomic, so two workers never
 * both call the gateway; a claim also expires, so a crash mid-call is picked up again by the reconciliation job,
 * and the idempotency key stops the gateway refunding twice.
 */
async function processRefund(refundId) {
  const now = new Date();
  const refund = await Refund.findOneAndUpdate(
    { _id: refundId, $or: [{ status: S.APPROVED }, { status: S.PROCESSING, providerRefundId: { $exists: false }, nextAttemptAt: { $lte: now } }] },
    { $set: { status: S.PROCESSING, nextAttemptAt: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 }, $push: { events: ev('processing') } },
    { returnDocument: 'after' }
  );
  if (!refund) return Refund.findById(refundId);

  const payment = await Payment.findById(refund.payment);
  let provider;
  try { provider = getProvider(); } catch (err) {
    await Refund.updateOne({ _id: refund._id }, { $push: { events: ev('provider_unavailable') } });
    return Refund.findById(refund._id);       // stays "processing"; retried when the gateway is configured
  }
  if (provider.name !== payment.provider) return fail(refund._id, `This payment was made through ${payment.provider}, which is not the configured gateway.`);
  if (!payment.providerPaymentId) return fail(refund._id, 'The payment has no gateway payment id.');

  let result;
  try {
    result = await provider.refundPayment({
      paymentId: payment.providerPaymentId, amountPaise: refund.amountPaise, idempotencyKey: String(refund._id),
      notes: { refund: String(refund._id), student: String(refund.student) }
    });
  } catch (err) {
    if (err.code === 'GATEWAY_UNREACHABLE' && refund.attempts < MAX_ATTEMPTS) {
      await Refund.updateOne({ _id: refund._id }, { $push: { events: ev('gateway_unreachable') } });
      return Refund.findById(refund._id);     // the lease expires and the job tries again
    }
    return fail(refund._id, err.message || 'The gateway rejected the refund.');
  }

  await Refund.updateOne({ _id: refund._id, providerRefundId: { $exists: false } }, { $set: { providerRefundId: result.id, provider: provider.name, simulated: provider.simulated } });
  if (result.status === 'processed') return complete(refund._id);
  if (result.status === 'failed') return fail(refund._id, 'The gateway reported the refund as failed.');
  await Refund.updateOne({ _id: refund._id }, { $set: { nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000) }, $push: { events: ev('pending_at_gateway') } });
  return Refund.findById(refund._id);
}

/** Signed gateway notification about a refund. Idempotent: completing twice books it once. */
async function handleProviderEvent(evt) {
  const refund = await Refund.findOne({ providerRefundId: evt.refundId });
  if (!refund) return 'unknown_refund';
  if (evt.amountPaise !== refund.amountPaise) {
    await Refund.updateOne({ _id: refund._id }, { $push: { events: ev('webhook_amount_mismatch', null, { evt }) } });
    return 'amount_mismatch';
  }
  if (evt.kind === 'refund_processed') await complete(refund._id);
  else await fail(refund._id, 'The gateway reported the refund as failed.');
  return 'processed';
}

/** Job: resumes interrupted work (stale claims, gateway-pending refunds, completed-but-unbooked refunds, un-released reservations). */
async function reconcile({ limit = 50 } = {}) {
  const now = new Date();
  let touched = 0;
  const stuck = await Refund.find({ status: S.PROCESSING, nextAttemptAt: { $lte: now } }).limit(limit);
  for (const r of stuck) {
    try {
      if (r.providerRefundId) {
        const remote = await getProvider().fetchRefund(r.providerRefundId);
        if (remote.status === 'processed') await complete(r._id);
        else if (remote.status === 'failed') await fail(r._id, 'The gateway reported the refund as failed.');
        else await Refund.updateOne({ _id: r._id }, { $set: { nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000) } });
      } else await processRefund(r._id);
      touched += 1;
    } catch (err) { logger.warn('refund reconcile step failed', { refund: String(r._id), error: err.message }); }
  }
  for (const r of await Refund.find({ status: S.COMPLETED, applied: false }).limit(limit)) { await applyCompleted(r); touched += 1; }
  for (const r of await Refund.find({ status: { $in: [S.FAILED, S.REJECTED] }, released: false }).limit(limit)) { await release(r); touched += 1; }
  return { touched };
}

/* -------------------------------------------------------------------- views */

async function list({ college, status, studentId, skip = 0, limit = 50 }) {
  const filter = { college: college._id, ...(status ? { status } : {}), ...(studentId ? { student: studentId } : {}) };
  const [total, rows] = await Promise.all([
    Refund.countDocuments(filter),
    Refund.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } })
      .populate('requestedBy', 'name').populate('decidedBy', 'name').populate('payment', 'receiptNo amountPaise providerPaymentId simulated').lean()
  ]);
  return { total, rows };
}

/** What the student sees: status and amount, never internal events or gateway ids. */
const forStudent = async studentId => (await Refund.find({ student: studentId }).sort({ createdAt: -1 }).limit(50).lean())
  .map(r => ({ id: String(r._id), amountPaise: r.amountPaise, status: r.status, reason: r.reason, requestedAt: r.createdAt, decidedAt: r.decidedAt, completedAt: r.status === S.COMPLETED ? r.updatedAt : null }));

module.exports = { request, approve, reject, retry, processRefund, complete, handleProviderEvent, reconcile, list, forStudent };
