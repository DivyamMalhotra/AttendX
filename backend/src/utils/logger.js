const { AsyncLocalStorage } = require('async_hooks');
const pino = require('pino');
const { config } = require('../config/env');

/** Per-request context (request id, user id) merged into every log line written during that request. */
const context = new AsyncLocalStorage();

const base = pino({
  level: config.logLevel,
  base: { service: 'attendx' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Defence in depth: these keys are blanked wherever they appear in a logged object.
  redact: {
    paths: [
      'password', 'newPassword', 'currentPassword', 'token', 'tokenHash', 'authorization', 'cookie', 'secret',
      'signature', 'razorpay_signature', '*.password', '*.newPassword', '*.currentPassword', '*.token', '*.authorization',
      '*.cookie', '*.secret', '*.signature', 'req.headers.authorization', 'req.headers.cookie'
    ],
    censor: '[redacted]'
  }
});

const emit = (level, msg, meta) => {
  const store = context.getStore();
  base[level]({ ...(store || {}), ...(meta || {}) }, msg);
};

module.exports = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
  context,
  /** Runs fn with extra context fields attached to every log line inside it. */
  withContext: (fields, fn) => context.run({ ...(context.getStore() || {}), ...fields }, fn)
};
