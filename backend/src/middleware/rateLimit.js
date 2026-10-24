const rateLimit = require('express-rate-limit');
const { config } = require('../config/env');

const handler = (message, code) => (req, res) => {
  res.status(429).json({ error: { code, message } });
};

/** Limits can be tightened/loosened per instance through app options (used by tests). */
function createLimiters(overrides = {}) {
  const relaxed = config.isTest ? 10_000 : null;
  const make = (windowMs, max, message, code, extra = {}) => rateLimit({
    windowMs, limit: relaxed ?? max, standardHeaders: true, legacyHeaders: false,
    handler: handler(message, code), ...extra
  });

  return {
    api: make(60_000, overrides.apiMax ?? 600, 'Too many requests. Please slow down.', 'RATE_LIMITED'),
    login: make(15 * 60_000, overrides.loginMax ?? 10, 'Too many sign-in attempts. Try again in a few minutes.', 'LOGIN_RATE_LIMITED', {
      limit: overrides.loginMax ?? relaxed ?? 10,
      skipSuccessfulRequests: true
    }),
    // 5 reset requests / confirmations per IP per hour
    passwordReset: make(60 * 60_000, overrides.passwordResetMax ?? 5, 'Too many password reset attempts. Try again later.', 'RATE_LIMITED', {
      limit: overrides.passwordResetMax ?? relaxed ?? 5
    }),
    sensitive: make(15 * 60_000, overrides.sensitiveMax ?? 40, 'Too many attempts. Please wait before trying again.', 'RATE_LIMITED', {
      limit: overrides.sensitiveMax ?? relaxed ?? 40
    })
  };
}

module.exports = { createLimiters };
