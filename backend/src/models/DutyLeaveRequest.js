const mongoose = require('mongoose');
const { DUTY_LEAVE_STATUS } = require('../config/constants');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = Object.values(DUTY_LEAVE_STATUS);

const historySchema = new mongoose.Schema({
  status: { type: String, enum: STATUSES, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now },
  remark: { type: String, maxlength: 500, default: '' }
}, { _id: false });

const documentSchema = new mongoose.Schema({
  storedName: String,
  originalName: String,
  mimeType: String,
  size: Number
}, { _id: false });

const dutyLeaveRequestSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  mentor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  fromDate: { type: String, required: true, match: ISO },
  toDate: { type: String, required: true, match: ISO },
  leaveType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', default: null },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: STATUSES, default: DUTY_LEAVE_STATUS.PENDING },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  remark: { type: String, maxlength: 500, default: '' },
  document: { type: documentSchema, default: null },
  history: { type: [historySchema], default: [] }
}, { timestamps: true });

dutyLeaveRequestSchema.index({ student: 1, createdAt: -1 });
dutyLeaveRequestSchema.index({ mentor: 1, status: 1, createdAt: -1 });
dutyLeaveRequestSchema.index({ college: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('DutyLeaveRequest', dutyLeaveRequestSchema);
