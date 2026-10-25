const mongoose = require('mongoose');

const who = { type: mongoose.Schema.Types.ObjectId, ref: 'User' };
const fileSchema = new mongoose.Schema({ storedName: String, originalName: String, mimeType: String, size: Number }, { _id: false });

const assignmentSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  instructions: { type: String, trim: true, maxlength: 5000, default: '' },
  publishAt: { type: Date, default: null },
  deadline: { type: Date, required: true },
  maxMarks: { type: Number, default: 10, min: 0, max: 1000 },
  allowLate: { type: Boolean, default: false },
  allowResubmit: { type: Boolean, default: true },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft' },
  attachments: { type: [fileSchema], default: [] },
  createdBy: who
}, { timestamps: true });
assignmentSchema.index({ section: 1, status: 1, deadline: 1 });
assignmentSchema.index({ subject: 1, createdAt: -1 });

const submissionSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  files: { type: [fileSchema], default: [] },
  note: { type: String, maxlength: 1000, default: '' },
  submittedAt: { type: Date, required: true },
  late: { type: Boolean, default: false },
  attempt: { type: Number, default: 1 },
  status: { type: String, enum: ['submitted', 'graded', 'returned'], default: 'submitted' },
  marks: { type: Number, default: null, min: 0 },
  feedback: { type: String, maxlength: 2000, default: '' },
  gradedBy: who, gradedAt: Date,
  // marks and feedback stay private to staff until the teacher releases them
  releasedAt: { type: Date, default: null },
  history: { type: [{ at: Date, by: who, action: String, marks: Number, note: String, _id: false }], default: [] }
}, { timestamps: true });
submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
submissionSchema.index({ student: 1, submittedAt: -1 });

const materialSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  topic: { type: String, trim: true, maxlength: 100, default: '' },
  resourceType: { type: String, enum: ['lecture_notes', 'slides', 'reference', 'question_paper', 'other'], default: 'lecture_notes' },
  file: { type: fileSchema, required: true },
  createdBy: who
}, { timestamps: true });
materialSchema.index({ section: 1, subject: 1, createdAt: -1 });

module.exports = {
  Assignment: mongoose.model('Assignment', assignmentSchema),
  AssignmentSubmission: mongoose.model('AssignmentSubmission', submissionSchema),
  StudyMaterial: mongoose.model('StudyMaterial', materialSchema)
};
