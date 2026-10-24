const { forbidden } = require('../utils/errors');

/**
 * Backend permission check (the UI hiding a button is never the control). Passes when the signed-in
 * user holds ANY of the listed permissions. Must run after requireAuth, which resolves req.perms.
 */
const requirePermission = (...perms) => (req, res, next) => {
  if (!req.perms || !req.perms.canAny(perms)) return next(forbidden());
  next();
};

module.exports = { requirePermission };
