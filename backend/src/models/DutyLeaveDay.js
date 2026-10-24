const mongoose = require('mongoose');
const { DUTY_LEAVE_STATUS } = require('../config/constants');

/**
 * One row per calendar day covered by a duty leave request.
 * This is what makes "no duplicate duty leave for the same student and date" a
 * database-level guarantee even for multi-day requests: while a request is pending
 * or approved its day rows are `active`, and the partial unique index below allows
 * only one active row per student and date. Rejected/cancelled requests release
 * their days (subject to the configurable resubmission policy, checked in the service).
 */
const dutyLeaveDaySchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  request: { type: mongoose.Schema.Types.ObjectId, ref: 'DutyLeaveRequest', required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  state: { type: String, enum: Object.values(DUTY_LEAVE_STATUS), required: true },
  active: { type: Boolean, required: true },
  // copied from the leave type: only exempt days change attendance calculations (missing = legacy duty leave = exempt)
  exempt: { type: Boolean, default: true }
}, { timestamps: true });

dutyLeaveDaySchema.index(
  { student: 1, date: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_active_leave_per_student_date' }
);
dutyLeaveDaySchema.index({ request: 1 });
dutyLeaveDaySchema.index({ student: 1, state: 1, date: 1 });

module.exports = mongoose.model('DutyLeaveDay', dutyLeaveDaySchema);
