const { FeeAssignment, StudentProfile, College } = require('../models');
const { NOTIFICATION_TYPES } = require('../config/constants');
const { todayISO, addDays, diffDays } = require('../utils/dates');
const { formatINR } = require('../utils/money');
const { outstandingPaise } = require('../utils/feeMath');
const notifications = require('./notificationService');

/**
 * Fee reminders, driven by the college's schedule (days relative to the due date, plus an optional repeat while
 * overdue). A reminder is keyed on (fee, schedule slot), so running the job any number of times a day sends each
 * reminder once, and a fee that has been paid in full is never reminded.
 */
const kindFor = (offset, today, dueDate) => (diffDays(dueDate, today) === offset ? `d${offset}` : null);

async function remindCollege(college, today = todayISO(college.settings.timezone)) {
  const cfg = college.settings.feeReminders;
  if (!cfg || !cfg.enabled) return { sent: 0, checked: 0 };

  const offsets = [...new Set(cfg.offsetsDays || [])];
  const dueDates = offsets.map(o => addDays(today, -o));
  const filters = [{ dueDate: { $in: dueDates } }];
  if (cfg.repeatEveryDays > 0) filters.push({ dueDate: { $lt: today } });

  const fees = await FeeAssignment.find({ college: college._id, $or: filters, $expr: { $gt: ['$totalPayablePaise', '$paidPaise'] } }).limit(5000);
  let sent = 0;
  for (const fee of fees) {
    let kind = null;
    for (const o of offsets) kind = kind || kindFor(o, today, fee.dueDate);
    if (!kind && cfg.repeatEveryDays > 0) {
      const late = diffDays(fee.dueDate, today);
      if (late > 0 && late % cfg.repeatEveryDays === 0) kind = `r${late}`;
    }
    if (!kind) continue;

    const profile = await StudentProfile.findById(fee.student).select('user').lean();
    if (!profile) continue;
    const late = diffDays(fee.dueDate, today);
    const label = fee.category === 'semester' ? `Semester ${fee.semesterNumber} fee` : fee.description || 'Fee';
    const when = late < 0 ? `is due on ${fee.dueDate}` : late === 0 ? 'is due today' : `was due on ${fee.dueDate}`;
    const n = await notifications.notify({
      collegeId: college._id, userId: profile.user, type: NOTIFICATION_TYPES.FEE_REMINDER, title: late > 0 ? 'Fee overdue' : 'Fee reminder',
      message: `${label} ${when}. Outstanding: ${formatINR(outstandingPaise(fee))}.`,
      data: { assignmentId: String(fee._id) }, dedupeKey: `feeremind:${fee._id}:${kind}`, link: 'student.html#fees'
    });
    if (n) sent += 1;
  }
  return { sent, checked: fees.length };
}

async function remindAll() {
  const colleges = await College.find({ active: true });
  const total = { sent: 0, checked: 0 };
  for (const c of colleges) {
    const r = await remindCollege(c);
    total.sent += r.sent; total.checked += r.checked;
  }
  return total;
}

module.exports = { remindCollege, remindAll };
