const path = require('path');

// The backend lives in <repo>/backend and serves the browser app from <repo>/frontend/public.
// Paths are resolved from this file, so the server works no matter which folder it is started from.
const BACKEND_ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const list = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);

const razorpay = {
  keyId: env.RAZORPAY_KEY_ID || '',
  keySecret: env.RAZORPAY_KEY_SECRET || '',
  webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || ''
};

function resolveProvider() {
  const requested = (env.PAYMENT_PROVIDER || '').toLowerCase();
  const haveKeys = Boolean(razorpay.keyId && razorpay.keySecret);
  if (requested === 'razorpay') return haveKeys ? 'razorpay' : 'none';
  if (requested === 'simulator') return isProd ? 'none' : 'simulator';
  if (haveKeys) return 'razorpay';
  return isProd ? 'none' : 'simulator';
}

const config = Object.freeze({
  nodeEnv,
  isProd,
  isTest,
  port: int(env.PORT, 3000),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/attendx',
  sessionSecret: env.SESSION_SECRET || '',
  sessionTtlMs: int(env.SESSION_TTL_HOURS, 8) * 60 * 60 * 1000,
  cookieSecure: env.COOKIE_SECURE === 'true' || (env.COOKIE_SECURE !== 'false' && isProd),
  trustProxy: env.TRUST_PROXY && env.TRUST_PROXY !== '0' ? (Number.isFinite(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  corsOrigins: list(env.CORS_ORIGINS),
  bcryptRounds: int(env.BCRYPT_ROUNDS, isTest ? 4 : 12),
  timezone: env.APP_TIMEZONE || 'Asia/Kolkata',
  logLevel: env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  publicDir: path.join(BACKEND_ROOT, '..', 'frontend', 'public'),
  uploads: {
    dir: path.resolve(BACKEND_ROOT, env.UPLOAD_DIR || 'uploads'),
    maxBytes: int(env.MAX_UPLOAD_MB, 2) * 1024 * 1024
  },
  payments: {
    provider: resolveProvider(),
    requestedProvider: (env.PAYMENT_PROVIDER || '').toLowerCase(),
    razorpay,
    currency: 'INR'
  },
  jobs: {
    enabled: env.JOBS_ENABLED !== 'false',
    alertIntervalMin: int(env.ALERT_JOB_INTERVAL_MIN, 30),
    reconcileIntervalMin: int(env.PAYMENT_RECONCILE_INTERVAL_MIN, 10)
  },
  receiptLogoPath: env.RECEIPT_LOGO_PATH ? path.resolve(env.RECEIPT_LOGO_PATH) : '',

  // Public base URL used in e-mailed links (password reset, announcements). Must be https in production.
  appBaseUrl: (env.APP_BASE_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ''),
  healthToken: env.HEALTH_TOKEN || '',

  email: {
    provider: (env.EMAIL_PROVIDER || 'none').toLowerCase(),   // smtp | none
    from: env.EMAIL_FROM || 'AttendX <no-reply@localhost>',
    smtp: {
      host: env.SMTP_HOST || '', port: int(env.SMTP_PORT, 587), secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '', pass: env.SMTP_PASS || ''
    }
  },
  sms: {
    provider: (env.SMS_PROVIDER || 'none').toLowerCase(),     // twilio | none
    twilio: { accountSid: env.TWILIO_ACCOUNT_SID || '', authToken: env.TWILIO_AUTH_TOKEN || '', from: env.TWILIO_FROM || '' }
  },
  notifications: { maxAttempts: int(env.NOTIFY_MAX_ATTEMPTS, 5), queueIntervalMin: int(env.NOTIFY_QUEUE_INTERVAL_MIN, 1) },

  backup: {
    dir: path.resolve(BACKEND_ROOT, env.BACKUP_DIR || 'backups'),
    encryptionKey: env.BACKUP_ENCRYPTION_KEY || '',          // 64 hex chars (32 bytes) enables AES-256-GCM
    retentionDays: int(env.BACKUP_RETENTION_DAYS, 14),
    keepMin: int(env.BACKUP_KEEP_MIN, 3),
    intervalHours: int(env.BACKUP_INTERVAL_HOURS, 24)
  }
});

/** Throws with a readable message when the process must not start with this configuration. */
function assertStartupConfig(cfg = config) {
  const problems = [];
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET must be set to a random string of at least 32 characters.');
  }
  if (cfg.isProd && /change-me/i.test(cfg.sessionSecret)) {
    problems.push('SESSION_SECRET still has the placeholder value from .env.example.');
  }
  if (problems.length) {
    throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));
  }
}

module.exports = { config, assertStartupConfig };
