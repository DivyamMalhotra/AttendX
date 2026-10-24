const mongoose = require('mongoose');

const ref = (to, extra = {}) => ({ type: mongoose.Schema.Types.ObjectId, ref: to, ...extra });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ library */

const bookSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  title: { type: String, required: true, trim: true, maxlength: 200 },
  author: { type: String, trim: true, maxlength: 120, default: '' },
  isbn: { type: String, trim: true, uppercase: true, maxlength: 20 },     // digits/X only, no hyphens
  category: { type: String, trim: true, maxlength: 60, default: 'General' },
  publisher: { type: String, trim: true, maxlength: 100, default: '' }
}, { timestamps: true });
bookSchema.index({ college: 1, isbn: 1 }, { unique: true, partialFilterExpression: { isbn: { $type: 'string' } } });
bookSchema.index({ college: 1, title: 'text', author: 'text' });

/** One physical copy. Availability is always derived from copy status, so there is no counter to drift. */
const copySchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  book: ref('Book', { required: true }),
  accessionNo: { type: String, required: true, trim: true, uppercase: true },
  status: { type: String, enum: ['available', 'issued', 'lost', 'retired'], default: 'available' }
}, { timestamps: true });
copySchema.index({ college: 1, accessionNo: 1 }, { unique: true });
copySchema.index({ book: 1, status: 1 });

const issueSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  copy: ref('BookCopy', { required: true }),
  book: ref('Book', { required: true }),
  student: ref('StudentProfile', { required: true }),
  issuedOn: { type: String, required: true, match: ISO },
  dueDate: { type: String, required: true, match: ISO },
  returnedOn: { type: String, match: ISO, default: null },
  status: { type: String, enum: ['issued', 'returned', 'lost'], default: 'issued' },
  fineAssessedPaise: { type: Number, default: 0, min: 0 },
  fineCharge: ref('FeeAssignment', { default: null }),
  issuedBy: ref('User'), returnedBy: ref('User')
}, { timestamps: true });
// A physical copy can only be on loan once.
issueSchema.index({ copy: 1 }, { unique: true, partialFilterExpression: { status: 'issued' }, name: 'one_active_loan_per_copy' });
issueSchema.index({ student: 1, status: 1 });
issueSchema.index({ college: 1, status: 1, dueDate: 1 });

/* ------------------------------------------------------------------- hostel */

const hostelSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  name: { type: String, required: true, trim: true, maxlength: 80 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
  type: { type: String, enum: ['boys', 'girls', 'mixed'], default: 'mixed' },
  warden: ref('User', { default: null }),
  // optional per-term charge, billed through the fee system as a separate "hostel" charge
  feePerTermPaise: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });
hostelSchema.index({ college: 1, code: 1 }, { unique: true });

const roomSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  hostel: ref('Hostel', { required: true }),
  floor: { type: Number, default: 0, min: 0, max: 50 },
  number: { type: String, required: true, trim: true, maxlength: 12 },
  capacity: { type: Number, required: true, min: 1, max: 20 },
  // incremented/decremented atomically with a guard, which is what makes over-allocation impossible
  occupied: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });
roomSchema.index({ hostel: 1, number: 1 }, { unique: true });

const allocationSchema = new mongoose.Schema({
  college: ref('College', { required: true }),
  hostel: ref('Hostel', { required: true }),
  room: ref('HostelRoom', { required: true }),
  student: ref('StudentProfile', { required: true }),
  from: { type: String, required: true, match: ISO },
  to: { type: String, match: ISO, default: null },
  status: { type: String, enum: ['allocated', 'checked_in', 'ended'], default: 'allocated' },
  checkedInAt: Date, checkedOutAt: Date,
  transferredFrom: ref('HostelAllocation', { default: null }),
  charge: ref('FeeAssignment', { default: null }),
  createdBy: ref('User'), endedBy: ref('User'), endReason: { type: String, maxlength: 200 }
}, { timestamps: true });
allocationSchema.index({ student: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['allocated', 'checked_in'] } }, name: 'one_active_bed_per_student' });
allocationSchema.index({ room: 1, status: 1 });
allocationSchema.index({ college: 1, student: 1, createdAt: -1 });

module.exports = {
  Book: mongoose.model('Book', bookSchema),
  BookCopy: mongoose.model('BookCopy', copySchema),
  LibraryIssue: mongoose.model('LibraryIssue', issueSchema),
  Hostel: mongoose.model('Hostel', hostelSchema),
  HostelRoom: mongoose.model('HostelRoom', roomSchema),
  HostelAllocation: mongoose.model('HostelAllocation', allocationSchema)
};
