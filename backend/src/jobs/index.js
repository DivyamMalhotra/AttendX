const { College } = require('../models');
const runner = require('./runner');
const alerts = require('../services/alertService');
const payments = require('../services/paymentService');
const deliveries = require('../services/deliveryService');
const { isConfigured } = require('../services/payments');
const { config } = require('../config/env');

/**
 * Background job catalogue. Every job is idempotent: alerts are keyed per student/subject cycle,
 * payment settlement steps are individually idempotent, deliveries are claimed atomically, and jobs
 * added by later modules key their effects on natural identifiers (see each service). Overlapping
 * runs, restarts or several app instances are therefore safe, and runner.js adds a cross-instance lock.
 */
runner.defineJob({
  name: 'attendance-alerts', intervalMin: config.jobs.alertIntervalMin, lockMinutes: 20,
  async run() {
    const colleges = await College.find({ active: true }).select('_id');
    let students = 0;
    for (const c of colleges) students += await alerts.evaluateCollege(c._id);
    return { colleges: colleges.length, students };
  }
});

runner.defineJob({
  name: 'payment-reconcile', intervalMin: config.jobs.reconcileIntervalMin,
  async run() {
    if (!isConfigured()) return { skipped: 'payments not configured' };
    return payments.reconcileOpenPayments();
  }
});

runner.defineJob({
  name: 'notification-queue', intervalMin: config.notifications.queueIntervalMin, lockMinutes: 5,
  run: () => deliveries.processQueue({ limit: 200 })
});

// Jobs contributed by feature modules register themselves here as they are added.
['./academicJobs', './financeJobs', './opsJobs'].forEach(file => {
  try { require(file); } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; }
});

function startJobs() {
  if (!config.jobs.enabled) return () => {};
  return runner.startScheduler();
}

module.exports = { startJobs, runJob: runner.runJob, jobStatus: runner.status, jobNames: runner.names };
