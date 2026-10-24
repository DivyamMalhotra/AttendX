const { College } = require('../models');
const runner = require('./runner');
const timetables = require('../services/timetableService');
const lifecycle = require('../services/sessionLifecycleService');
const { todayISO, addDays } = require('../utils/dates');
const { config } = require('../config/env');

/** Creates upcoming class sessions from approved timetables (today + 14 days). Safe to run repeatedly. */
runner.defineJob({
  name: 'generate-sessions', intervalMin: 60 * 6,
  async run() {
    const colleges = await College.find({ active: true });
    const total = { created: 0, linked: 0, revived: 0 };
    for (const c of colleges) {
      const today = todayISO(c.settings.timezone);
      const r = await timetables.generate(c._id, today, addDays(today, 14));
      Object.keys(total).forEach(k => { total[k] += r[k]; });
    }
    return total;
  }
});

/** Flags finished classes that never received attendance (once per class). */
runner.defineJob({
  name: 'detect-unmarked', intervalMin: 15,
  async run() {
    const colleges = await College.find({ active: true });
    let flagged = 0;
    for (const c of colleges) flagged += await lifecycle.detectUnmarked(c);
    return { flagged };
  }
});

module.exports = { enabled: config.jobs.enabled };
