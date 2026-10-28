const mongoose = require('mongoose');

/**
 * A kind of leave a student can apply for. Whether an approved leave of this type removes absences from the
 * attendance calculation is a per-type policy (`exemptsAttendance`), never assumed. Types marked `sensitive`
 * (medical) are reviewed only by holders of leave.reviewMedical, and their documents and reasons are kept
 * away from faculty and other students.
 */
const leaveTypeSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z][a-z0-9_]{1,30}$/ },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, trim: true, maxlength: 200, default: '' },
  exemptsAttendance: { type: Boolean, default: false },
  requiresDocument: { type: Boolean, default: false },
  sensitive: { type: Boolean, default: false },
  maxDaysPerRequest: { type: Number, default: 31, min: 1, max: 31 },
  active: { type: Boolean, default: true },
  builtIn: { type: Boolean, default: false }
}, { timestamps: true });

leaveTypeSchema.index({ college: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('LeaveType', leaveTypeSchema);
