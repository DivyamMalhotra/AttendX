const mongoose = require('mongoose');
const { EXAM_STATUS } = require('../config/constants');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const who = { type: mongoose.Schema.Types.ObjectId, ref: 'User' };

/** Grading scale set by the institution. Nothing is assumed: results cannot be published without one. */
const bandSchema = new mongoose.Schema({
  minPercent: { type: Number, required: true, min: 0, max: 100 },
  grade: { type: String, required: true, trim: true, maxlength: 6 },
  points: { type: Number, required: true, min: 0, max: 100 },
  pass: { type: Boolean, default: true }
}, { _id: false });

const gradingPolicySchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  bands: { type: [bandSchema], validate: v => v.length > 0 },
  absentGrade: { type: String, default: 'AB', maxlength: 6 },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  updatedBy: who
}, { timestamps: true });
gradingPolicySchema.index({ college: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_policy' });

const examSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  type: { type: String, enum: ['internal', 'midterm', 'final', 'practical', 'other'], default: 'internal' },
  academicSession: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
  semesterNumber: { type: Number, required: true, min: 1, max: 12 },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  date: { type: String, required: true, match: ISO },
  startTime: { type: String, match: HHMM, default: null },
  endTime: { type: String, match: HHMM, default: null },
  venue: { type: String, trim: true, maxlength: 60, default: '' },
  maxMarks: { type: Number, required: true, min: 1, max: 1000 },
  passMarks: { type: Number, required: true, min: 0 },
  components: { type: [{ name: { type: String, maxlength: 60 }, maxMarks: Number, _id: false }], default: [] },
  countsForGpa: { type: Boolean, default: true },

  status: { type: String, enum: Object.values(EXAM_STATUS), default: EXAM_STATUS.DRAFT },
  revision: { type: Number, default: 1 },
  submittedBy: who, submittedAt: Date,
  reviewedBy: who, reviewedAt: Date,
  lockedBy: who, lockedAt: Date,
  publishedBy: who, publishedAt: Date,
  reopenLog: { type: [{ at: Date, by: who, reason: String, fromStatus: String, _id: false }], default: [] },
  createdBy: who
}, { timestamps: true });

examSchema.index({ college: 1, subject: 1, name: 1, academicSession: 1 }, { unique: true });
examSchema.index({ college: 1, section: 1, date: 1 });
examSchema.index({ college: 1, status: 1 });

const marksSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  marks: { type: Number, default: null, min: 0 },
  absent: { type: Boolean, default: false },
  remark: { type: String, maxlength: 200, default: '' },
  enteredBy: who,
  updatedBy: who,
  // every change is kept: who, when, from what, and why (reason mandatory once the exam left draft entry)
  history: { type: [{ marks: Number, absent: Boolean, by: who, at: Date, reason: String, revision: Number, _id: false }], default: [] },
  // The official, frozen outcome written at publication. Later grading-policy edits never change it;
  // only a documented reopen + republish does.
  final: {
    state: String, percent: Number, grade: String, points: Number, passed: Boolean, policyVersion: Number, revision: Number, at: Date
  }
}, { timestamps: true });
marksSchema.index({ exam: 1, student: 1 }, { unique: true });
marksSchema.index({ student: 1 });

module.exports = {
  GradingPolicy: mongoose.model('GradingPolicy', gradingPolicySchema),
  Exam: mongoose.model('Exam', examSchema),
  MarksEntry: mongoose.model('MarksEntry', marksSchema)
};
