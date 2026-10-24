const mongoose = require('mongoose');
const { FEE_COMPONENT_KINDS, FEE_CATEGORIES } = require('../config/constants');
const { preventDeletion } = require('./plugins');

const safeInt = { validator: Number.isSafeInteger, message: 'Amount must be an integer number of paise.' };

const componentSchema = new mongoose.Schema({
  name: String,
  kind: { type: String, enum: FEE_COMPONENT_KINDS },
  amountPaise: { type: Number, min: 0, validate: safeInt }
}, { _id: false });

const adjustmentSchema = new mongoose.Schema({
  kind: { type: String, enum: ['concession', 'charge'], required: true },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  amountPaise: { type: Number, required: true, min: 1, validate: safeInt },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now }
}, { _id: false });

/**
 * A student's fee for one academic session and semester. The components are copied
 * (snapshotted) from the fee structure when assigned, so later edits to the
 * structure never rewrite what a student was actually charged.
 */
const feeAssignmentSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  // 'semester' is the tuition-style fee of Phase 1. Library fines, hostel charges etc. are separate
  // records in their own category so they are never merged into tuition.
  category: { type: String, enum: FEE_CATEGORIES, default: 'semester' },
  description: { type: String, trim: true, maxlength: 160, default: '' },
  chargeRef: { type: { kind: String, id: String }, default: null, _id: false },
  academicSession: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', default: null },
  semesterNumber: { type: Number, default: 0, min: 0, max: 12 },
  structure: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeStructure', default: null },
  structureVersion: { type: Number, default: 1 },
  course: String,
  specialization: String,
  components: [componentSchema],
  grossPaise: { type: Number, required: true, min: 0, validate: safeInt },
  adjustments: { type: [adjustmentSchema], default: [] },
  totalPayablePaise: { type: Number, required: true, min: 0, validate: safeInt },
  // Only advanced by verified payments, through an atomic guarded $inc (see paymentFinalizer).
  paidPaise: { type: Number, default: 0, min: 0, validate: safeInt },
  appliedPayments: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  // verified money given back; reduces paidPaise exactly once per refund (see refundService)
  refundedPaise: { type: Number, default: 0, min: 0 },
  appliedRefunds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  // late-fee assessment ids (and '<id>:waived') already booked on this fee: makes booking idempotent
  appliedLateFees: { type: [String], default: [] },
  dueDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null }
}, { timestamps: true });

feeAssignmentSchema.index(
  { student: 1, academicSession: 1, semesterNumber: 1 },
  { unique: true, partialFilterExpression: { category: 'semester' }, name: 'one_semester_fee_per_student' }
);
feeAssignmentSchema.index(
  { 'chargeRef.kind': 1, 'chargeRef.id': 1 },
  { unique: true, partialFilterExpression: { 'chargeRef.kind': { $type: 'string' } }, name: 'one_charge_per_source' }
);
feeAssignmentSchema.index({ student: 1, category: 1 });
feeAssignmentSchema.index({ college: 1, academicSession: 1, semesterNumber: 1 });

preventDeletion(feeAssignmentSchema, 'A fee assignment');

module.exports = mongoose.model('FeeAssignment', feeAssignmentSchema);
