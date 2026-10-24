const mongoose = require('mongoose');
const { PAYMENT_STATUS } = require('../config/constants');
const { preventDeletion } = require('./plugins');

const eventSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  type: { type: String, required: true },
  detail: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

/** A payment attempt/transaction. Never deleted; failed and cancelled attempts stay as history. */
const paymentSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  rollNoSnapshot: { type: String, required: true },
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeAssignment', required: true },
  academicSession: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', default: null },
  semesterNumber: { type: Number, default: 0 },
  category: { type: String, default: 'semester' },
  amountPaise: { type: Number, required: true, min: 100, validate: Number.isSafeInteger },
  currency: { type: String, default: 'INR' },
  provider: { type: String, required: true },
  simulated: { type: Boolean, default: false },
  providerOrderId: { type: String, required: true },
  providerPaymentId: { type: String },
  status: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.CREATED },
  failureReason: { type: String, default: '' },
  paidAt: { type: Date, default: null },
  receiptNo: { type: String, default: null },
  // true once the amount has been added to the fee assignment's paid total
  applied: { type: Boolean, default: false },
  // refunds: reserved covers requested/approved/processing; completed is money actually returned
  refundReservedPaise: { type: Number, default: 0, min: 0 },
  refundedPaise: { type: Number, default: 0, min: 0 },
  appliedRefunds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  releasedRefunds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  balanceAfterPaise: { type: Number, default: null },
  // verified money that could not be applied (e.g. overpayment race) and needs an administrator
  needsReview: { type: Boolean, default: false },
  events: { type: [eventSchema], default: [] }
}, { timestamps: true });

paymentSchema.index({ providerOrderId: 1 }, { unique: true });
paymentSchema.index(
  { providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { providerPaymentId: { $type: 'string' } } }
);
paymentSchema.index({ student: 1, createdAt: -1 });
paymentSchema.index({ college: 1, status: 1, createdAt: -1 });
paymentSchema.index({ assignment: 1, status: 1 });

preventDeletion(paymentSchema, 'A payment transaction');

module.exports = mongoose.model('Payment', paymentSchema);
