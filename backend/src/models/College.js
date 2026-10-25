const mongoose = require('mongoose');
const { DEFAULT_SETTINGS, DUTY_LEAVE_POLICIES } = require('../config/constants');

const channel = new mongoose.Schema({ email: Boolean, sms: Boolean }, { _id: false });

const settingsSchema = new mongoose.Schema({
  attendanceThreshold: { type: Number, default: DEFAULT_SETTINGS.attendanceThreshold, min: 1, max: 100 },
  dutyLeavePolicy: { type: String, enum: Object.values(DUTY_LEAVE_POLICIES), default: DEFAULT_SETTINGS.dutyLeavePolicy },
  allowResubmitAfterRejection: { type: Boolean, default: DEFAULT_SETTINGS.allowResubmitAfterRejection },
  attendanceEditWindowDays: { type: Number, default: DEFAULT_SETTINGS.attendanceEditWindowDays, min: 0, max: 365 },
  allowPartialPayments: { type: Boolean, default: DEFAULT_SETTINGS.allowPartialPayments },
  timezone: { type: String, default: DEFAULT_SETTINGS.timezone },

  // Notification channels per event type (overrides the catalogue defaults); SMS stays off unless enabled here.
  notifications: { type: Map, of: channel, default: () => ({}) },
  smsEnabled: { type: Boolean, default: false },

  feeReminders: {
    enabled: { type: Boolean, default: true },
    // days relative to the due date: -7 = a week before, 0 = on the day, 7 = a week after
    offsetsDays: { type: [Number], default: () => [-7, 0, 7] },
    repeatEveryDays: { type: Number, default: 0, min: 0, max: 90 }
  },

  unmarked: {
    graceMinutes: { type: Number, default: 30, min: 0, max: 1440 },
    notifyAdmins: { type: Boolean, default: true }
  },

  atRisk: {
    attendanceBelow: { type: Number, default: 75, min: 1, max: 100 },
    flagOverdueFees: { type: Boolean, default: true },
    flagFailingResults: { type: Boolean, default: true },
    flagMissingAssignments: { type: Boolean, default: true },
    minFlags: { type: Number, default: 1, min: 1, max: 4 }
  },

  library: {
    loanDays: { type: Number, default: 14, min: 1, max: 365 },
    finePerDayPaise: { type: Number, default: 200, min: 0 },
    maxFinePaise: { type: Number, default: 50000, min: 0 },
    maxActiveIssues: { type: Number, default: 3, min: 1, max: 50 },
    chargeFinesToFees: { type: Boolean, default: true }
  },

  qr: {
    enabled: { type: Boolean, default: true },
    rotateSeconds: { type: Number, default: 30, min: 10, max: 300 },
    sessionMinutes: { type: Number, default: 15, min: 1, max: 180 },
    geofence: {
      enabled: { type: Boolean, default: false },
      lat: { type: Number, default: null, min: -90, max: 90 },
      lng: { type: Number, default: null, min: -180, max: 180 },
      radiusMeters: { type: Number, default: 200, min: 20, max: 5000 }
    }
  },

  // What linked parents/guardians may see; counselling notes are never exposed to parents.
  parentVisibility: {
    attendance: { type: Boolean, default: true },
    leave: { type: Boolean, default: true },
    results: { type: Boolean, default: true },
    fees: { type: Boolean, default: true },
    payments: { type: Boolean, default: false },
    announcements: { type: Boolean, default: true }
  }
}, { _id: false });

const collegeSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 20, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 150 },
  address: { type: String, trim: true, maxlength: 300, default: '' },
  active: { type: Boolean, default: true },
  settings: { type: settingsSchema, default: () => ({}) }
}, { timestamps: true });

module.exports = mongoose.model('College', collegeSchema);
