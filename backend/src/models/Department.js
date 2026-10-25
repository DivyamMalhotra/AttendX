const mongoose = require('mongoose');

/**
 * Organisational hierarchy: College (institution) > Department > Course/Semester/Section.
 * Sections point at a department; courses and semesters stay attributes of sections.
 * `campus` is optional text so single-campus colleges can ignore it.
 */
const departmentSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
  campus: { type: String, trim: true, maxlength: 80, default: '' },
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  active: { type: Boolean, default: true }
}, { timestamps: true });

departmentSchema.index({ college: 1, code: 1 }, { unique: true });
departmentSchema.index({ college: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);
