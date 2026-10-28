const path = require('path');
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
const CHART_DIR = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist');

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

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://checkout.razorpay.com'],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
        'img-src': ["'self'", 'data:', 'https:'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  }));

  if (config.corsOrigins.length) {
    app.use('/api', cors({ origin: config.corsOrigins, credentials: true }));
  }

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

  // Chart.js is served from this server (no third-party CDN), so the CSP needs no extra allowance.
  app.use('/vendor', express.static(CHART_DIR, { setHeaders: res => res.setHeader('Cache-Control', 'public, max-age=86400') }));

  // Assets always revalidate (cheap 304s) so a deployed update is never hidden behind a stale cached module.
  app.use(express.static(config.publicDir, {
    extensions: ['html'], index: 'index.html',
    setHeaders: (res, file) => {
      res.setHeader('Cache-Control', 'no-cache');
      if (file.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
    }
  }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, WEBHOOK_PATH };
