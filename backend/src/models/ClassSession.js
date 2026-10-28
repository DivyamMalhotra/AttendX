const mongoose = require('mongoose');
const { SESSION_STATUS } = require('../config/constants');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One scheduled class: a subject taught on a date in a time slot.
 * Sessions are created either by the timetable generator, ad hoc by faculty, or by the legacy import.
 * Once created they are never deleted: a changed timetable cancels future sessions instead.
 */
const classSessionSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  // Human label such as "9:00 AM – 10:00 AM"; part of the uniqueness key.
  slot: { type: String, required: true, maxlength: 40 },
  startTime: { type: String, match: HHMM, default: null },
  endTime: { type: String, match: HHMM, default: null },
  room: { type: String, trim: true, maxlength: 40, default: '' },

  status: { type: String, enum: Object.values(SESSION_STATUS), default: SESSION_STATUS.SCHEDULED },
  source: { type: String, enum: ['timetable', 'adhoc', 'legacy'], default: 'adhoc' },
  timetableEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'TimetableEntry', default: null },
  cancelReason: { type: String, maxlength: 200, default: '' },

  counts: {
    present: { type: Number, default: 0 },
    absent: { type: Number, default: 0 }
  },

  // Set by the unmarked-class detector and cleared when attendance arrives or the incident is resolved.
  unmarkedAt: { type: Date, default: null },
  resolution: {
    action: { type: String, enum: ['explained', 'cancelled', 'completed_without_attendance'] },
    reason: { type: String, maxlength: 300 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: Date
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// A subject can run several sessions a day (different slots) but only one per slot.
classSessionSchema.index({ subject: 1, date: 1, slot: 1 }, { unique: true });
classSessionSchema.index({ section: 1, date: -1 });
classSessionSchema.index({ college: 1, date: -1 });
classSessionSchema.index({ teacher: 1, date: 1 });
classSessionSchema.index({ college: 1, status: 1, date: 1 });
classSessionSchema.index({ timetableEntry: 1, date: 1 });

module.exports = mongoose.model('ClassSession', classSessionSchema);
