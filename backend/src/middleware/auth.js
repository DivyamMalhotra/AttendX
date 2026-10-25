const { User, College } = require('../models');
const { unauthorized, forbidden, AppError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const { COOKIE_NAME } = require('../config/session');
const permissionService = require('../services/permissionService');

function destroySession(req, res) {
  return new Promise(resolve => {
    if (!req.session) return resolve();
    req.session.destroy(() => {
      res.clearCookie(COOKIE_NAME);
      resolve();
    });
  });
}

/**
 * Loads the signed-in user from the session on every request, so deactivating an
 * account, changing its role or resetting its password takes effect immediately.
 * Options: { allowPasswordChange } lets a user flagged `mustChangePassword` reach
 * the endpoints needed to change it.
 */
function requireAuth({ allowPasswordChange = false } = {}) {
  return asyncHandler(async (req, res, next) => {
    const sess = req.session;
    if (!sess || !sess.userId) throw unauthorized();

    const [user, college] = await Promise.all([
      User.findById(sess.userId),
      College.findById(sess.collegeId)
    ]);

    const invalid = !user || !user.active || !college || !college.active
      || String(user.college) !== String(sess.collegeId)
      || user.role !== sess.role
      || (user.passwordChangedAt && sess.loginAt < user.passwordChangedAt.getTime());
    if (invalid) {
      await destroySession(req, res);
      throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_INVALID');
    }

    if (user.mustChangePassword && !allowPasswordChange) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password first.');
    }

    req.user = user;
    req.college = college;
    req.perms = await permissionService.resolve(user);
    next();
  });
}

/** Loads the signed-in user when there is a valid session, but lets anonymous callers through. */
const optionalAuth = (req, res, next) => requireAuth({ allowPasswordChange: true })(req, res, () => next());

/** Restricts a route to one or more roles. Always used after requireAuth. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
  next();
};

module.exports = { requireAuth, optionalAuth, requireRole, destroySession };
