const crypto = require('crypto');
const mongoose = require('mongoose');
const router = require('express').Router();
const { config } = require('../config/env');
const jobs = require('../jobs/runner');
const { BackupRun } = require('../models');
const { isConfigured } = require('../services/payments');
const { optionalAuth } = require('../middleware/auth');

/** Liveness: says only that the process is up. Safe for load balancers and public monitors. */
router.get('/health', (req, res) => res.json({ status: 'ok' }));

const tokenOk = req => {
  if (!config.healthToken) return false;
  const given = Buffer.from(String(req.get('x-health-token') || ''));
  const want = Buffer.from(config.healthToken);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
};

/**
 * Readiness: dependency status. Restricted to callers holding HEALTH_TOKEN (or the session of a user with
 * system.health) so internals are never exposed publicly.
 * It never returns connection strings, environment values or stack traces.
 */
router.get('/ready', optionalAuth, async (req, res) => {
  const allowed = tokenOk(req) || (req.perms && req.perms.can('system.health'));
  if (!allowed) return res.status(req.user ? 403 : 401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not allowed.' } });

  const dbUp = mongoose.connection.readyState === 1;
  let dbPing = false;
  if (dbUp) { try { await mongoose.connection.db.admin().ping(); dbPing = true; } catch (e) { dbPing = false; } }
  const [jobRows, backup] = dbPing ? await Promise.all([jobs.status(), BackupRun.findOne().sort({ startedAt: -1 }).lean()]) : [[], null];
  const failedJobs = jobRows.filter(j => j.last && j.last.status === 'failed').map(j => j.name);

  const ok = dbPing;
  res.status(ok ? 200 : 503).json({
    status: ok ? (failedJobs.length ? 'degraded' : 'ok') : 'unavailable',
    checks: {
      database: { ok: dbPing },
      jobs: { failed: failedJobs, count: jobRows.length },
      backup: backup ? { status: backup.status, at: backup.startedAt } : { status: 'none' },
      payments: { configured: isConfigured() }
    },
    uptimeSeconds: Math.round(process.uptime())
  });
});

module.exports = router;
