/**
 * AttendX frontend server.
 *
 *  - serves the static client (HTML, CSS, ES modules, icons, service worker) from ./public
 *  - serves Chart.js from node_modules at /vendor (no third-party CDN)
 *  - proxies /api, /health and /ready to the backend, so the browser sees a SINGLE origin.
 *    That is what keeps the HttpOnly session cookie, the CSRF token and the service worker working
 *    without any CORS or cookie-domain configuration.
 *
 * Configuration (frontend/.env or real environment variables):
 *   PORT         port for the web UI                (default 5173)
 *   BACKEND_URL  where the API runs                 (default http://127.0.0.1:3000)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const express = require('express');
const helmet = require('helmet');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = parseInt(process.env.PORT, 10) || 5173;
const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const isProd = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHART_DIR = path.join(__dirname, 'node_modules', 'chart.js', 'dist');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1);

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
      'upgrade-insecure-requests': isProd ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  // Plain-http localhost must never be pinned to https by a stale HSTS header.
  strictTransportSecurity: isProd
}));

// ---- API proxy (registered BEFORE any body parser so request bodies stream through untouched) ----
const proxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: false,          // keep the browser's Host so cookies / redirects stay on the frontend origin
  xfwd: true,                   // pass X-Forwarded-* so the backend sees the real client IP (set TRUST_PROXY=1 there)
  proxyTimeout: 30_000,
  on: {
    error: (err, req, res) => {
      if (!res || res.headersSent || typeof res.writeHead !== 'function') return;
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: { code: 'BACKEND_UNREACHABLE', message: `Cannot reach the AttendX backend at ${BACKEND_URL}. Is it running?` } }));
    }
  }
});
app.use(['/api', '/health', '/ready'], (req, res, next) => {
  // Express strips the mount path; restore it so the backend receives the full original URL.
  req.url = req.originalUrl;
  return proxy(req, res, next);
});

// ---- static client ----
app.use('/vendor', express.static(CHART_DIR, { setHeaders: res => res.setHeader('Cache-Control', 'public, max-age=86400') }));
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'index.html',
  setHeaders: (res, file) => {
    res.setHeader('Cache-Control', 'no-cache');
    if (file.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
  }
}));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

app.listen(PORT, () => {
  console.log(`AttendX frontend  ->  http://localhost:${PORT}   (API proxied to ${BACKEND_URL})`);
});
