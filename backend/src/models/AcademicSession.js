const mongoose = require('mongoose');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const schema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true, trim: true, maxlength: 30 },
  startDate: { type: String, required: true, match: ISO },
  endDate: { type: String, required: true, match: ISO },
  isCurrent: { type: Boolean, default: false }
}, { timestamps: true });

schema.index({ college: 1, name: 1 }, { unique: true });
// At most one current academic session per college, enforced by the database.
schema.index({ college: 1 }, { unique: true, partialFilterExpression: { isCurrent: true }, name: 'one_current_session' });

module.exports = mongoose.model('AcademicSession', schema);
