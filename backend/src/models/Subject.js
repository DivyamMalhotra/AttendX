const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  nameKey: { type: String, required: true },
  code: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
  credits: { type: Number, default: 0, min: 0, max: 40 },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

subjectSchema.index({ section: 1, nameKey: 1 }, { unique: true });
subjectSchema.index({ college: 1, teacher: 1 });

module.exports = mongoose.model('Subject', subjectSchema);
