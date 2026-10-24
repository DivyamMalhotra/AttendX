const mongoose = require('mongoose');

const ref = (to, extra = {}) => ({ type: mongoose.Schema.Types.ObjectId, ref: to, ...extra });

/** Who mentors whom, with history: reassigning ends the current row and creates a new one. */
const mentorAssignmentSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  student: ref('StudentProfile', { required: true }),
  mentor: ref('User', { required: true }),
  academicSession: ref('AcademicSession', { default: null }),
  from: { type: Date, default: Date.now },
  to: { type: Date, default: null },
  reason: { type: String, maxlength: 200, default: '' },
  createdBy: ref('User')
}, { timestamps: true });
// A student has at most one ACTIVE mentor.
mentorAssignmentSchema.index({ student: 1 }, { unique: true, partialFilterExpression: { to: null }, name: 'one_active_mentor' });
mentorAssignmentSchema.index({ mentor: 1, to: 1 });

/** Counselling notes: confidential. Read access is the author or holders of mentorNotes.view (never implicit). */
const noteSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  student: ref('StudentProfile', { required: true }),
  author: ref('User', { required: true }),
  noteDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  category: { type: String, enum: ['academic', 'attendance', 'personal', 'career', 'financial', 'other'], default: 'academic' },
  content: { type: String, required: true, trim: true, maxlength: 5000 },
  context: { type: String, trim: true, maxlength: 200, default: '' },    // e.g. "Semester 3, Data Structures"
  followUp: {
    action: { type: String, trim: true, maxlength: 300, default: '' },
    dueDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    done: { type: Boolean, default: false },
    doneAt: Date
  }
}, { timestamps: true });
noteSchema.index({ student: 1, noteDate: -1 });
noteSchema.index({ author: 1, 'followUp.done': 1, 'followUp.dueDate': 1 });

/** A parent/guardian account linked to one student, created and verified by the institution. */
const parentLinkSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  parent: ref('User', { required: true }),
  student: ref('StudentProfile', { required: true }),
  relationship: { type: String, enum: ['mother', 'father', 'guardian', 'other'], default: 'guardian' },
  status: { type: String, enum: ['active', 'revoked'], default: 'active' },
  // how the institution verified this person (mandatory: roll number alone never grants access)
  verificationNote: { type: String, required: true, trim: true, maxlength: 300 },
  verifiedBy: ref('User'),
  verifiedAt: { type: Date, default: Date.now },
  revokedBy: ref('User'), revokedAt: Date, revokeReason: { type: String, maxlength: 200 }
}, { timestamps: true });
parentLinkSchema.index({ parent: 1, student: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_link' });
parentLinkSchema.index({ student: 1, status: 1 });

module.exports = {
  MentorAssignment: mongoose.model('MentorAssignment', mentorAssignmentSchema),
  MentorNote: mongoose.model('MentorNote', noteSchema),
  ParentLink: mongoose.model('ParentLink', parentLinkSchema)
};
