const crypto = require('crypto');
const logger = require('../utils/logger');

const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Gives every request an id (a valid incoming X-Request-Id is reused so traces can span a proxy;
 * anything else is replaced), returns it in the response, and writes one structured access-log line
 * with status and duration when the response finishes. Query strings are never logged (they can hold tokens).
 */
function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const started = process.hrtime.bigint();

  logger.context.run({ requestId: req.id }, () => {
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'static';
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level]('request', {
        method: req.method, path: req.originalUrl.split('?')[0], route, status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - started) / 1000000n),
        userId: req.user ? String(req.user._id) : undefined
      });
    });
    next();
  });
}

module.exports = requestContext;
