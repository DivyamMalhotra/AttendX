const mongoose = require('mongoose');
const { FEE_COMPONENT_KINDS } = require('../config/constants');

const componentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  kind: { type: String, enum: FEE_COMPONENT_KINDS, default: 'other' },
  amountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger }
}, { _id: false });

/** Template of charges for a course/specialization in one academic session and semester. */
const feeStructureSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  course: { type: String, required: true, trim: true, maxlength: 80 },
  specialization: { type: String, trim: true, maxlength: 80, default: '' },
  academicSession: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
  semesterNumber: { type: Number, required: true, min: 1, max: 12 },
  components: { type: [componentSchema], validate: v => v.length > 0 },
  totalPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  dueDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
  version: { type: Number, default: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

feeStructureSchema.index(
  { college: 1, course: 1, specialization: 1, academicSession: 1, semesterNumber: 1 },
  { unique: true }
);

module.exports = mongoose.model('FeeStructure', feeStructureSchema);
