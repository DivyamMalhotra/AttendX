const mongoose = require('mongoose');
const { normalizeRollNo, isValidRollNo } = require('../utils/rollNumber');

const studentSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  // Always stored normalized (see utils/rollNumber); the setter is a second line of defence.
  rollNo: {
    type: String, required: true, set: normalizeRollNo,
    validate: { validator: isValidRollNo, message: 'Roll number must be 3-25 letters, digits, "-" or "/".' }
  },
  phone: { type: String, trim: true, maxlength: 20, default: '' },
  admissionYear: { type: Number, min: 1990, max: 2100 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

studentSchema.index({ college: 1, rollNo: 1 }, { unique: true });
studentSchema.index({ section: 1, active: 1 });

module.exports = mongoose.model('StudentProfile', studentSchema);
