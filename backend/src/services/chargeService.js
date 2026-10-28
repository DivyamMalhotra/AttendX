const { FeeAssignment } = require('../models');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { badRequest } = require('../utils/errors');
const audit = require('./auditService');

/**
 * Non-tuition charges (library fines, other dues) are separate fee records in their own category
 * and flow through exactly the same payment, receipt, refund and reporting pipeline as semester fees.
 * They are never added to a semester fee, so tuition and ancillary charges stay distinguishable.
 *
 * Idempotent per source: (kind, id) identifies the event that caused the charge (for example the library
 * loan), and a unique index guarantees it can only ever be charged once, however often this runs.
 */
async function createCharge({ actor = null, college, studentId, category, description, amountPaise, dueDate = null, source }) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw badRequest('A charge must be a positive amount.', undefined, 'INVALID_AMOUNT');
  if (!source || !source.kind || !source.id) throw badRequest('A charge needs the source record it belongs to.', undefined, 'SOURCE_REQUIRED');
  const chargeRef = { kind: source.kind, id: String(source.id) };

  const existing = await FeeAssignment.findOne({ 'chargeRef.kind': chargeRef.kind, 'chargeRef.id': chargeRef.id });
  if (existing) return { charge: existing, created: false };
  try {
    const charge = await FeeAssignment.create({
      college: college._id, student: studentId, category, description, chargeRef,
      components: [{ name: description, kind: 'other', amountPaise }], grossPaise: amountPaise, totalPayablePaise: amountPaise, dueDate
    });
    await audit.record({ actor, collegeId: college._id, action: 'charge.created', entityType: 'FeeAssignment', entityId: charge._id, meta: { category, amountPaise, source: chargeRef } });
    return { charge, created: true };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    return { charge: await FeeAssignment.findOne({ 'chargeRef.kind': chargeRef.kind, 'chargeRef.id': chargeRef.id }), created: false };
  }
}

module.exports = { createCharge };
