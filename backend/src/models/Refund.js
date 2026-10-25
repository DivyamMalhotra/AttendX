const mongoose = require('mongoose');
const { REFUND_STATUS } = require('../config/constants');
const { preventDeletion } = require('./plugins');

const eventSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  type: { type: String, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  detail: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

/**
 * A refund of (part of) one verified payment. The amount is reserved on the payment while the request is open
 * (requested/approved/processing), becomes "refunded" only when the gateway confirms, and is never deleted.
 */
const refundSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeAssignment', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  amountPaise: { type: Number, required: true, min: 100, validate: Number.isSafeInteger },
  reason: { type: String, required: true, trim: true, maxlength: 300 },
  // also lower the amount payable by the same value, so a refund of an over-collection does not re-open the dues
  reduceFee: { type: Boolean, default: false },
  status: { type: String, enum: Object.values(REFUND_STATUS), default: REFUND_STATUS.REQUESTED },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
  decisionNote: { type: String, default: '', maxlength: 300 },
  provider: { type: String, default: '' },
  simulated: { type: Boolean, default: false },
  providerRefundId: { type: String },
  failureReason: { type: String, default: '' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: null },
  // true once the money movement has been booked on the payment and fee assignment
  applied: { type: Boolean, default: false },
  // true once a failed/rejected refund has handed its reservation back to the payment
  released: { type: Boolean, default: false },
  events: { type: [eventSchema], default: [] }
}, { timestamps: true });

refundSchema.index({ providerRefundId: 1 }, { unique: true, partialFilterExpression: { providerRefundId: { $type: 'string' } } });
refundSchema.index({ college: 1, status: 1, createdAt: -1 });
refundSchema.index({ payment: 1, status: 1 });
refundSchema.index({ student: 1, createdAt: -1 });
refundSchema.index({ status: 1, nextAttemptAt: 1 });

preventDeletion(refundSchema, 'A refund');

module.exports = mongoose.model('Refund', refundSchema);
