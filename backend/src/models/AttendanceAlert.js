const mongoose = require('mongoose');

/** Current shortage state per student and subject (one row, reused across shortage cycles). */
const alertSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  status: { type: String, enum: ['active', 'resolved'], required: true },
  cycle: { type: Number, default: 1 },
  attended: { type: Number, default: 0 },
  eligible: { type: Number, default: 0 },
  percentage: { type: Number, default: null },
  threshold: { type: Number, required: true },
  openedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },
  lastEvaluatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

alertSchema.index({ student: 1, subject: 1 }, { unique: true });
alertSchema.index({ college: 1, status: 1 });

module.exports = mongoose.model('AttendanceAlert', alertSchema);
