const bcrypt = require('bcryptjs');
const { User, College } = require('../models');
const { config } = require('../config/env');
const { unauthorized, badRequest, AppError } = require('../utils/errors');
const audit = require('./auditService');

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
// Compared against when the account does not exist so timing does not reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

const hashPassword = plain => bcrypt.hash(plain, config.bcryptRounds);

/**
 * Validates credentials for one college. Every failure returns the same generic message.
 * Accounts are temporarily locked after repeated failures.
 */
async function authenticate({ collegeCode, email, password, ip }) {
  const fail = () => unauthorized('Invalid college code, email or password.', 'INVALID_CREDENTIALS');

  const college = await College.findOne({ code: String(collegeCode).trim().toUpperCase(), active: true });
  const user = college
    ? await User.findOne({ college: college._id, email: String(email).trim().toLowerCase() }).select('+passwordHash')
    : null;

  if (!user || !user.active) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw fail();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = (user.failedLogins || 0) + 1;
    const update = failed >= MAX_FAILED
      ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
      : { failedLogins: failed };
    await User.updateOne({ _id: user._id }, { $set: update });
    await audit.record({ actor: user, action: 'auth.login_failed', entityType: 'User', entityId: user._id, ip, meta: { locked: failed >= MAX_FAILED } });
    throw fail();
  }

  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit.record({ actor: user, action: 'auth.login', entityType: 'User', entityId: user._id, ip });
  return { user, college };
}

async function changePassword({ user, currentPassword, newPassword, ip }) {
  const full = await User.findById(user._id).select('+passwordHash');
  if (!(await bcrypt.compare(currentPassword, full.passwordHash))) {
    throw badRequest('Your current password is incorrect.', undefined, 'WRONG_PASSWORD');
  }
  if (currentPassword === newPassword) throw badRequest('Choose a password different from the current one.');
  full.passwordHash = await hashPassword(newPassword);
  full.passwordChangedAt = new Date();
  full.mustChangePassword = false;
  await full.save();
  await audit.record({ actor: user, action: 'auth.password_changed', entityType: 'User', entityId: user._id, ip });
  return full;
}

module.exports = { authenticate, changePassword, hashPassword };
