const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  // Base role (what kind of account this is). Extra permissions come from `customRoles`.
  role: { type: String, enum: Object.values(ROLES), required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
  phone: { type: String, trim: true, maxlength: 20, default: '' },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  passwordChangedAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  failedLogins: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },

  customRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
  // Departments this user's department-scoped roles apply to.
  departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  // Optional opt-outs for non-mandatory notifications.
  notificationPrefs: {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: true }
  }
}, { timestamps: true });

userSchema.index({ college: 1, email: 1 }, { unique: true });
userSchema.index({ college: 1, role: 1, active: 1 });
// One designated Administrator per college, enforced by the database itself (not only by the create-admin script).
userSchema.index({ college: 1 }, { unique: true, partialFilterExpression: { role: 'admin' }, name: 'one_admin_per_college' });

/** Safe public projection: never exposes the hash or lockout internals. */
userSchema.methods.toPublic = function () {
  return {
    id: String(this._id), name: this.name, email: this.email, role: this.role,
    college: String(this.college), mustChangePassword: this.mustChangePassword
  };
};

module.exports = mongoose.model('User', userSchema);
