const mongoose = require('mongoose');
const { preventDeletion } = require('./plugins');

/** Permanent receipt for exactly one verified successful payment; `snapshot` is what the PDF is rendered from. */
const receiptSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  receiptNo: { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

receiptSchema.index({ college: 1, receiptNo: 1 }, { unique: true });
receiptSchema.index({ student: 1, createdAt: -1 });

preventDeletion(receiptSchema, 'A receipt');

module.exports = mongoose.model('Receipt', receiptSchema);
