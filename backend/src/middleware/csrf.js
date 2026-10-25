const crypto = require('crypto');
const { AppError } = require('../utils/errors');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const HEADER = 'x-csrf-token';

/** Returns the session's CSRF token, creating it (and thereby the session) if needed. */
function issueToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Synchronizer-token CSRF protection for every state-changing request.
 * The token lives only in the server-side session and is sent by the client in a header,
 * which a cross-site form or script cannot set. `exempt` lists signed webhook paths.
 */
function csrfProtection({ exempt = [] } = {}) {
  return (req, res, next) => {
    if (SAFE.has(req.method) || exempt.some(p => req.path === p || req.originalUrl.split('?')[0] === p)) return next();
    const sent = req.get(HEADER);
    const expected = req.session && req.session.csrfToken;
    if (!sent || !expected || !safeEqual(sent, expected)) {
      return next(new AppError(403, 'CSRF_INVALID', 'Security token missing or invalid. Refresh the page and try again.'));
    }
    next();
  };
}

module.exports = { csrfProtection, issueToken };
