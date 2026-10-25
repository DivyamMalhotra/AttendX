const mongoose = require('mongoose');

const sectionSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  sem: { type: String, required: true, trim: true, maxlength: 20 },
  semesterNumber: { type: Number, min: 1, max: 12, required: true },
  course: { type: String, trim: true, maxlength: 80, default: '' },
  specialization: { type: String, trim: true, maxlength: 80, default: '' },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  mentor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  nameKey: { type: String, required: true }
}, { timestamps: true });

sectionSchema.index({ college: 1, nameKey: 1, semesterNumber: 1 }, { unique: true });
sectionSchema.index({ department: 1 });

module.exports = mongoose.model('Section', sectionSchema);
