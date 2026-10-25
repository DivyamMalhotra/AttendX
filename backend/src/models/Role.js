const mongoose = require('mongoose');
const { PERMISSION_KEYS } = require('../config/permissions');

/** A named bundle of permissions an administrator can assign to staff users. */
const roleSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z][a-z0-9_]{1,30}$/ },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, trim: true, maxlength: 200, default: '' },
  permissions: { type: [String], default: [], validate: v => v.every(p => PERMISSION_KEYS.has(p)) },
  // college: applies everywhere; department: only inside the user's assigned departments
  scope: { type: String, enum: ['college', 'department'], default: 'college' },
  builtIn: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
}, { timestamps: true });

roleSchema.index({ college: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Role', roleSchema);
