const mongoose = require('mongoose');

/** Only a SHA-256 hash of the emailed token is stored; the token itself exists only in the e-mailed link. */
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  requestIp: { type: String, default: '' }
}, { timestamps: true });

schema.index({ user: 1, usedAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.model('PasswordResetToken', schema);
