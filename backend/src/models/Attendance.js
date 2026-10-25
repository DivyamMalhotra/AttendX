const mongoose = require('mongoose');
const { ATTENDANCE_STATUS, ATTENDANCE_SOURCE } = require('../config/constants');

const attendanceSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  classSession: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassSession', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  // Denormalized from the class session so statistics need no join; kept in sync on session edits.
  date: { type: String, required: true },
  status: { type: String, enum: Object.values(ATTENDANCE_STATUS), required: true },
  source: { type: String, enum: Object.values(ATTENDANCE_SOURCE), default: ATTENDANCE_SOURCE.FACULTY },
  markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// The integrity rule: one record per student per class session.
attendanceSchema.index({ classSession: 1, student: 1 }, { unique: true });
attendanceSchema.index({ student: 1, subject: 1 });
attendanceSchema.index({ subject: 1, date: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
