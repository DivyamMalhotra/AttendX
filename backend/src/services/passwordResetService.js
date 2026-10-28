const crypto = require('crypto');
const { User, College, PasswordResetToken } = require('../models');
const { config } = require('../config/env');
const { badRequest } = require('../utils/errors');
const { renderPasswordReset } = require('../templates/notificationTemplates');
const authService = require('./authService');
const delivery = require('./deliveryService');
const audit = require('./auditService');

const TOKEN_MINUTES = 30;
const MAX_REQUESTS_PER_HOUR = 3;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Starts a reset. The caller always receives the same generic answer, whether or not the account exists,
 * so this cannot be used to discover registered e-mail addresses.
 * The e-mailed link puts the token in the URL fragment (never sent to servers, proxies or referrers) and
 * only a SHA-256 hash of it is stored.
 */
async function request({ collegeCode, email, ip }) {
  const college = await College.findOne({ code: String(collegeCode).trim().toUpperCase(), active: true });
  const user = college ? await User.findOne({ college: college._id, email: String(email).trim().toLowerCase(), active: true }) : null;
  if (!user) return;

  const recent = await PasswordResetToken.countDocuments({ user: user._id, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) } });
  if (recent >= MAX_REQUESTS_PER_HOUR) return;   // silently throttled per account

  await PasswordResetToken.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } }); // older links die
  const token = crypto.randomBytes(32).toString('base64url');
  await PasswordResetToken.create({
    user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60000), requestIp: ip || ''
  });

  const resetUrl = `${config.appBaseUrl}/reset-password.html#token=${token}`;
  await delivery.sendDirectEmail({
    user, collegeId: college._id, purpose: 'password_reset',
    message: renderPasswordReset({ user, resetUrl, minutes: TOKEN_MINUTES })
  });
  await audit.record({ actor: user, collegeId: college._id, action: 'auth.password_reset_requested', entityType: 'User', entityId: user._id, ip });
}

/** Completes a reset: the token must exist, be unexpired and unused. Use is a single atomic claim. */
async function confirm({ token, newPassword, ip }) {
  const invalid = () => badRequest('This reset link is invalid or has expired. Request a new one.', undefined, 'INVALID_RESET_TOKEN');
  const record = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: sha256(String(token)), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!record) throw invalid();

  const user = await User.findById(record.user).select('+passwordHash');
  if (!user || !user.active) throw invalid();
  user.passwordHash = await authService.hashPassword(newPassword);
  user.passwordChangedAt = new Date();      // ends every existing session of this user
  user.mustChangePassword = false;
  user.failedLogins = 0;
  user.lockedUntil = null;
  await user.save();
  await PasswordResetToken.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
  await audit.record({ actor: user, collegeId: user.college, action: 'auth.password_reset_completed', entityType: 'User', entityId: user._id, ip });
}

module.exports = { request, confirm, TOKEN_MINUTES };
