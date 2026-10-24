const mongoose = require('mongoose');
const { FEE_CATEGORIES } = require('../config/constants');
const { preventDeletion } = require('./plugins');

/** One late-fee rule per college. Assessment is automatic (see lateFeeService) and never touches paid amounts. */
const policySchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true, unique: true },
  active: { type: Boolean, default: false },
  categories: { type: [String], enum: FEE_CATEGORIES, default: () => ['semester'] },
  graceDays: { type: Number, default: 0, min: 0, max: 365 },
  mode: { type: String, enum: ['flat', 'percent'], default: 'flat' },
  flatPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  percentBp: { type: Number, default: 0, min: 0, max: 10000 },          // basis points of the balance when assessed
  // how often it repeats while the dues stay unpaid
  period: { type: String, enum: ['once', 'daily', 'weekly', 'monthly'], default: 'once' },
  capPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },   // max total per fee; 0 = no cap
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

/** A late fee that was charged for one period of one fee. Unique per (fee, period), so reruns never double-charge. */
const assessmentSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeAssignment', required: true },
  periodKey: { type: String, required: true },
  amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  status: { type: String, enum: ['assessed', 'waived', 'void'], default: 'assessed' },
  applied: { type: Boolean, default: false },
  policy: { type: mongoose.Schema.Types.Mixed },
  waivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  waivedAt: { type: Date, default: null },
  waiveReason: { type: String, default: '', maxlength: 300 }
}, { timestamps: true });

assessmentSchema.index({ assignment: 1, periodKey: 1 }, { unique: true });
assessmentSchema.index({ college: 1, status: 1, createdAt: -1 });
assessmentSchema.index({ student: 1, createdAt: -1 });
preventDeletion(assessmentSchema, 'A late fee assessment');

module.exports = {
  LateFeePolicy: mongoose.model('LateFeePolicy', policySchema),
  LateFeeAssessment: mongoose.model('LateFeeAssessment', assessmentSchema)
};
