const mongoose = require('mongoose');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A weekly timetable for one section in one academic session. Changes create a new VERSION:
 * the old version is archived with an end date, never edited in place, so history is preserved.
 */
const timetableSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  academicSession: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
  version: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['draft', 'approved', 'archived'], default: 'draft' },
  effectiveFrom: { type: String, required: true, match: ISO },
  effectiveTo: { type: String, match: ISO, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

timetableSchema.index({ section: 1, academicSession: 1, version: 1 }, { unique: true });
timetableSchema.index({ college: 1, status: 1, effectiveFrom: 1 });

const entrySchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  timetable: { type: mongoose.Schema.Types.ObjectId, ref: 'Timetable', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dayOfWeek: { type: Number, required: true, min: 1, max: 7 },
  startTime: { type: String, required: true, match: HHMM },
  endTime: { type: String, required: true, match: HHMM },
  room: { type: String, trim: true, maxlength: 40, default: '' },
  // An administrator may knowingly accept a clash (e.g. a combined lecture); it is recorded, never silent.
  override: { reason: { type: String, maxlength: 200 }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date }
}, { timestamps: true });

entrySchema.index({ timetable: 1, dayOfWeek: 1, startTime: 1 });
entrySchema.index({ college: 1, teacher: 1, dayOfWeek: 1 });
entrySchema.index({ college: 1, room: 1, dayOfWeek: 1 });

module.exports = {
  Timetable: mongoose.model('Timetable', timetableSchema),
  TimetableEntry: mongoose.model('TimetableEntry', entrySchema)
};
