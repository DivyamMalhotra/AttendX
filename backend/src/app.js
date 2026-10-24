const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { config } = require('./config/env');
const { createLimiters } = require('./middleware/rateLimit');
const { csrfProtection } = require('./middleware/csrf');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const requestContext = require('./middleware/requestContext');
const paymentWebhook = require('./controllers/paymentWebhookController');
const notificationWebhooks = require('./controllers/notificationWebhookController');

const WEBHOOK_PATH = '/api/fees/webhook';

/**
 * Builds the Express application. Everything environment specific (session store,
 * rate limits) is injected so tests can create isolated instances.
 */
function createApp({ sessionMiddleware, limiterOverrides } = {}) {
  const app = express();
  const limiters = createLimiters(limiterOverrides);

  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(requestContext);

  // API only: it returns JSON, never HTML, so a locked-down CSP is enough. The page CSP lives in the frontend server.
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
  }));

  // Normally the frontend proxies /api so the browser stays same-origin and no CORS is needed. Direct browser calls
  // from the frontend origin are still allowed (with cookies) for tools that bypass the proxy.
  const allowedOrigins = [...new Set([config.frontendUrl, ...config.corsOrigins])];
  app.use('/api', cors({ origin: allowedOrigins, credentials: true }));

  // Provider callbacks need the untouched request body to verify their signatures, so they are registered
  // before the JSON parser and are exempt from CSRF (they are authenticated by signature instead).
  app.post(WEBHOOK_PATH, express.raw({ type: '*/*', limit: '256kb' }), paymentWebhook.handle);
  app.post('/api/notifications/sms-status', express.urlencoded({ extended: false, limit: '32kb' }), notificationWebhooks.smsStatus);

  const health = require('./routes/healthRoutes');
  if (sessionMiddleware) app.use('/ready', sessionMiddleware);
  app.use(health);

  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', limiters.api);

  if (sessionMiddleware) app.use('/api', sessionMiddleware);
  app.use('/api', csrfProtection());
  app.use('/api', require('./routes')({ limiters }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, WEBHOOK_PATH };
