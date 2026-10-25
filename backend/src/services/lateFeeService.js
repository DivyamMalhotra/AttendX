const { FeeAssignment, StudentProfile, College } = require('../models');
const { LateFeePolicy, LateFeeAssessment } = require('../models/LateFee');
const { NOTIFICATION_TYPES } = require('../config/constants');
const { conflict, notFound } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { todayISO, addDays, diffDays } = require('../utils/dates');
const { formatINR } = require('../utils/money');
const notifications = require('./notificationService');
const audit = require('./auditService');
const logger = require('../utils/logger');

/**
 * Late fees. One policy per college (grace days, flat or percentage amount, optional repetition, optional cap).
 * The job assesses each overdue fee once per period: an assessment row is unique per (fee, period), and booking it
 * onto the fee is keyed on the assessment id, so repeated or overlapping runs never charge twice. A late fee is a
 * normal "charge" adjustment on the fee, so students pay it through the usual payment and receipt pipeline.
 */
const PERIOD_DAYS = { once: Infinity, daily: 1, weekly: 7, monthly: 30 };

const getPolicy = collegeId => LateFeePolicy.findOne({ college: collegeId });

async function savePolicy({ actor, college, input }) {
  const policy = await LateFeePolicy.findOneAndUpdate({ college: college._id }, { $set: { ...input, updatedBy: actor._id } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true });
  await audit.record({ actor, collegeId: college._id, action: 'latefee.policy_saved', entityType: 'LateFeePolicy', entityId: policy._id, meta: input });
  return policy;
}

const periodIndex = (daysPast, period) => (period === 'once' ? 0 : Math.floor(daysPast / PERIOD_DAYS[period]));

function amountFor(policy, outstandingPaise) {
  return policy.mode === 'percent' ? Math.floor((outstandingPaise * policy.percentBp) / 10000) : policy.flatPaise;
}

/** Books an assessment onto its fee exactly once; voids it when the fee was paid in the meantime. */
async function book(assessment) {
  const key = String(assessment._id);
  const updated = await FeeAssignment.findOneAndUpdate(
    { _id: assessment.assignment, appliedLateFees: { $ne: key }, $expr: { $gt: ['$totalPayablePaise', '$paidPaise'] } },
    {
      $inc: { totalPayablePaise: assessment.amountPaise },
      $push: { appliedLateFees: key, adjustments: { kind: 'charge', label: `Late fee (${assessment.periodKey})`, amountPaise: assessment.amountPaise, at: new Date() } }
    },
    { returnDocument: 'after' }
  );
  if (updated) {
    await LateFeeAssessment.updateOne({ _id: assessment._id }, { $set: { applied: true } });
    return 'booked';
  }
  if (await FeeAssignment.exists({ _id: assessment.assignment, appliedLateFees: key })) {
    await LateFeeAssessment.updateOne({ _id: assessment._id, applied: false }, { $set: { applied: true } });
    return 'booked';
  }
  await LateFeeAssessment.updateOne({ _id: assessment._id, applied: false }, { $set: { status: 'void' } });
  return 'void';
}

async function notifyStudent(assessment, assignment) {
  const profile = await StudentProfile.findById(assessment.student).select('user').lean();
  if (!profile) return;
  await notifications.notify({
    collegeId: assessment.college, userId: profile.user, type: NOTIFICATION_TYPES.LATE_FEE, title: 'Late fee added',
    message: `A late fee of ${formatINR(assessment.amountPaise)} was added to your overdue fee${assignment.dueDate ? ` (due ${assignment.dueDate})` : ''}.`,
    data: { assignmentId: String(assessment.assignment), assessmentId: String(assessment._id) }, dedupeKey: `latefee:${assessment._id}`, link: 'student.html#fees'
  });
}

/** Assesses every overdue fee of one college for `today`. Returns counts. */
async function assessCollege(college, today = todayISO(college.settings.timezone)) {
  const policy = await getPolicy(college._id);
  const result = { assessed: 0, skipped: 0 };
  if (!policy || !policy.active) return result;

  const threshold = addDays(today, -policy.graceDays);   // fees due before this date are past their grace period
  const overdue = await FeeAssignment.find({
    college: college._id, category: { $in: policy.categories }, dueDate: { $lt: threshold }, $expr: { $gt: ['$totalPayablePaise', '$paidPaise'] }
  }).limit(2000);

  for (const fee of overdue) {
    const daysPast = diffDays(addDays(fee.dueDate, policy.graceDays + 1), today);   // 0 on the first late day
    const last = periodIndex(daysPast, policy.period);
    for (let i = 0; i <= last; i += 1) {
      const periodKey = `p${i}`;
      const existing = await LateFeeAssessment.findOne({ assignment: fee._id, periodKey });
      if (existing) {
        if (!existing.applied && existing.status === 'assessed') await book(existing);    // finish a half-done earlier run
        continue;
      }
      const fresh = await FeeAssignment.findById(fee._id);
      let amount = amountFor(policy, Math.max(0, fresh.totalPayablePaise - fresh.paidPaise));
      if (policy.capPaise > 0) {
        const sofar = (await LateFeeAssessment.aggregate([{ $match: { assignment: fee._id, status: 'assessed' } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]))[0];
        amount = Math.min(amount, policy.capPaise - (sofar ? sofar.t : 0));
      }
      if (amount <= 0) { result.skipped += 1; continue; }
      let assessment;
      try {
        assessment = await LateFeeAssessment.create({
          college: college._id, student: fee.student, assignment: fee._id, periodKey: `p${i}`, amountPaise: amount,
          policy: { mode: policy.mode, flatPaise: policy.flatPaise, percentBp: policy.percentBp, period: policy.period, graceDays: policy.graceDays }
        });
      } catch (err) {
        if (isDuplicateKey(err)) continue;                // a concurrent run created it
        throw err;
      }
      if ((await book(assessment)) === 'booked') {
        result.assessed += 1;
        await audit.record({ collegeId: college._id, action: 'latefee.assessed', entityType: 'LateFeeAssessment', entityId: assessment._id, meta: { assignment: String(fee._id), amountPaise: amount, period: periodKey } });
        try { await notifyStudent(assessment, fee); } catch (err) { logger.warn('late fee notification failed', { error: err.message }); }
      }
    }
  }
  return result;
}

/** Waives an assessed late fee. Refused when the student already paid it (that needs a refund instead). */
async function waive({ actor, college, id, reason = '' }) {
  const assessment = await LateFeeAssessment.findOneAndUpdate(
    { _id: id, college: college._id, status: 'assessed', applied: true },
    { $set: { status: 'waived', waivedBy: actor._id, waivedAt: new Date(), waiveReason: reason } }, { returnDocument: 'after' });
  if (!assessment) {
    const row = await LateFeeAssessment.findOne({ _id: id, college: college._id }).select('status').lean();
    if (!row) throw notFound('Late fee not found.');
    throw conflict('INVALID_STATE', `This late fee is ${row.status} and cannot be waived.`);
  }
  const key = `${assessment._id}:waived`;
  const updated = await FeeAssignment.findOneAndUpdate(
    { _id: assessment.assignment, appliedLateFees: { $ne: key }, $expr: { $gte: [{ $subtract: ['$totalPayablePaise', assessment.amountPaise] }, '$paidPaise'] } },
    {
      $inc: { totalPayablePaise: -assessment.amountPaise },
      $push: { appliedLateFees: key, adjustments: { kind: 'concession', label: `Late fee waived (${assessment.periodKey})`, amountPaise: assessment.amountPaise, by: actor._id, at: new Date() } }
    },
    { returnDocument: 'after' }
  );
  if (!updated && !(await FeeAssignment.exists({ _id: assessment.assignment, appliedLateFees: key }))) {
    await LateFeeAssessment.updateOne({ _id: assessment._id }, { $set: { status: 'assessed', waivedBy: null, waivedAt: null, waiveReason: '' } });   // undo the claim
    throw conflict('ALREADY_PAID', 'The student has already paid this amount. Refund the payment instead of waiving the fee.');
  }
  await audit.record({ actor, collegeId: college._id, action: 'latefee.waived', entityType: 'LateFeeAssessment', entityId: assessment._id, meta: { amountPaise: assessment.amountPaise, reason } });
  const profile = await StudentProfile.findById(assessment.student).select('user').lean();
  if (profile) {
    await notifications.notify({
      collegeId: college._id, userId: profile.user, type: NOTIFICATION_TYPES.LATE_FEE, title: 'Late fee waived',
      message: `A late fee of ${formatINR(assessment.amountPaise)} was waived on your account.`, data: { assessmentId: String(assessment._id) }, dedupeKey: `latefee:${assessment._id}:waived`, link: 'student.html#fees'
    });
  }
  return assessment;
}

async function list({ college, status, studentId, skip = 0, limit = 50 }) {
  const filter = { college: college._id, ...(status ? { status } : {}), ...(studentId ? { student: studentId } : {}) };
  const [total, rows] = await Promise.all([
    LateFeeAssessment.countDocuments(filter),
    LateFeeAssessment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).populate('assignment', 'semesterNumber dueDate category').lean()
  ]);
  return { total, rows };
}

async function assessAll() {
  const colleges = await College.find({ active: true });
  const total = { assessed: 0, skipped: 0 };
  for (const c of colleges) {
    const r = await assessCollege(c);
    total.assessed += r.assessed; total.skipped += r.skipped;
  }
  return total;
}

module.exports = { getPolicy, savePolicy, assessCollege, assessAll, waive, list, book };
