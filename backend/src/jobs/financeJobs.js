const { College } = require('../models');
const runner = require('./runner');
const refunds = require('../services/refundService');
const lateFees = require('../services/lateFeeService');
const reminders = require('../services/feeReminderService');
const library = require('../services/libraryService');
const { isConfigured } = require('../services/payments');
const { config } = require('../config/env');

/** Resumes refunds that were interrupted or are waiting on the gateway. */
runner.defineJob({
  name: 'refund-reconcile', intervalMin: config.jobs.reconcileIntervalMin, lockMinutes: 10,
  async run() {
    if (!isConfigured()) return { skipped: 'payments not configured' };
    return refunds.reconcile();
  }
});

/** Charges late fees on overdue fees per each college's policy (once per fee and period). */
runner.defineJob({ name: 'late-fees', intervalMin: 60 * 6, lockMinutes: 30, run: () => lateFees.assessAll() });

/** Sends scheduled fee reminders (once per fee and schedule slot). */
runner.defineJob({ name: 'fee-reminders', intervalMin: 60 * 3, lockMinutes: 30, run: () => reminders.remindAll() });

/** Library due-date reminders (once per loan and kind). */
runner.defineJob({
  name: 'library-reminders', intervalMin: 60 * 6, lockMinutes: 30,
  async run() {
    let sent = 0;
    for (const c of await College.find({ active: true })) sent += await library.remindDue(c);
    return { sent };
  }
});
