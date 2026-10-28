const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');
const { addDays } = require('../../src/utils/dates');
const lateFees = require('../../src/services/lateFeeService');
const reminders = require('../../src/services/feeReminderService');

let ctx; let M; let hod; let clerk; let head; let teacher; let sessions;
const FEE = 1_000_000;
const DUE = '2026-03-01';
const id = x => String(x._id || x);
let semester = 0;

async function createFee(studentIdx, dueDate, amount = FEE) {
  semester += 1;
  const s = await hod.post('/api/admin/fees/structures', {
    course: 'B.Tech', specialization: 'CSE', academicSessionId: id(ctx.academicSession), semesterNumber: semester,
    components: [{ name: 'Tuition fee', kind: 'tuition', amountPaise: amount }], dueDate
  });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  await hod.post('/api/admin/fees/assign', { structureId: s.body.data.id || s.body.data._id, studentIds: [id(ctx.students[studentIdx].profile)] });
  return M.FeeAssignment.findOne({ student: ctx.students[studentIdx].profile._id, semesterNumber: semester });
}
async function payAll(agent, assignment) {
  const fresh = await M.FeeAssignment.findById(assignment._id);
  const order = await agent.post('/api/fees/orders', { assignmentId: id(assignment) });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const orderId = order.body.data.checkout.orderId;
  const sim = (await agent.post(`/api/fees/orders/${orderId}/simulate`, { outcome: 'success' })).body.data;
  assert.equal((await agent.post(`/api/fees/orders/${orderId}/verify`, { paymentId: sim.paymentId, signature: sim.signature })).status, 200);
  return fresh;
}
const college = () => M.College.findById(ctx.college._id);
const policy = body => hod.put('/api/admin/fees/late-fee-policy', body);

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'LTF1', students: 5 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  clerk = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'clerk@ltf1.edu' });
  head = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_head', email: 'head@ltf1.edu' });
  sessions = [];
  for (const s of ctx.students) sessions.push(await harness.login(creds(ctx.college, s.user)));
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('the late-fee policy is validated and only fee administrators can change it', async () => {
  assert.equal((await teacher.put('/api/admin/fees/late-fee-policy', { active: true })).status, 403);
  assert.equal((await sessions[0].put('/api/admin/fees/late-fee-policy', { active: true })).status, 403, 'students do not set policy');
  assert.equal((await policy({ percentBp: 20000 })).status, 400);
  assert.equal((await policy({ flatPaise: -5 })).status, 400);
  assert.equal((await policy({ mystery: true })).status, 400);
  assert.equal((await policy({})).status, 400);
  assert.equal((await clerk.get('/api/admin/fees/late-fee-policy')).body.data.active, false, 'nothing is charged until a policy is switched on');
  const saved = await policy({ active: false, graceDays: 2, mode: 'flat', flatPaise: 50_000, period: 'weekly', capPaise: 100_000 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.flatPaise, 50_000);
  assert.ok(await M.AuditLog.findOne({ action: 'latefee.policy_saved' }));
});

test('nothing is assessed while the policy is off or the fee is inside its grace period', async () => {
  const fee = await createFee(0, DUE);
  assert.deepEqual(await lateFees.assessCollege(await college(), addDays(DUE, 30)), { assessed: 0, skipped: 0 }, 'policy inactive');
  await policy({ active: true });
  assert.equal((await lateFees.assessCollege(await college(), DUE)).assessed, 0, 'not yet due');
  assert.equal((await lateFees.assessCollege(await college(), addDays(DUE, 2))).assessed, 0, 'inside the 2 grace days');
  assert.equal((await M.FeeAssignment.findById(fee._id)).totalPayablePaise, FEE);
});

test('a late fee is assessed once per period, even with overlapping runs', async () => {
  const fee = await M.FeeAssignment.findOne({ student: ctx.students[0].profile._id });
  const day = addDays(DUE, 3);
  const runs = await Promise.all([1, 2, 3, 4].map(async () => lateFees.assessCollege(await college(), day)));
  assert.equal(runs.reduce((n, r) => n + r.assessed, 0), 1, 'four simultaneous runs charge once');
  assert.equal((await lateFees.assessCollege(await college(), day)).assessed, 0, 'and so does a later run on the same day');
  const a = await M.FeeAssignment.findById(fee._id);
  assert.equal(a.totalPayablePaise, FEE + 50_000);
  assert.equal(a.adjustments.at(-1).kind, 'charge');
  assert.equal(await M.LateFeeAssessment.countDocuments({ assignment: fee._id }), 1);
  assert.ok(await M.Notification.findOne({ user: ctx.students[0].user._id, title: 'Late fee added' }));

  const s = (await sessions[0].get('/api/fees/summary')).body.data.semesters.find(x => x.id === id(fee));
  assert.equal(s.totalPayablePaise, FEE + 50_000, 'the student sees it as part of the fee');
  assert.equal(s.overdue, true);
});

test('weekly repetition stops at the cap and never exceeds it', async () => {
  const fee = await M.FeeAssignment.findOne({ student: ctx.students[0].profile._id });
  assert.equal((await lateFees.assessCollege(await college(), addDays(DUE, 3 + 7))).assessed, 1, 'week two');
  assert.equal((await lateFees.assessCollege(await college(), addDays(DUE, 3 + 14))).assessed, 0, 'week three is cut off by the 1,000 cap');
  const total = (await M.LateFeeAssessment.aggregate([{ $match: { assignment: fee._id, status: 'assessed' } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]))[0].t;
  assert.equal(total, 100_000);
  // catching up after the job did not run for weeks charges each missed period exactly once
  const fee2 = await createFee(1, DUE);
  await policy({ capPaise: 0 });
  const r = await lateFees.assessCollege(await college(), addDays(DUE, 3 + 14));
  assert.equal(await M.LateFeeAssessment.countDocuments({ assignment: fee2._id }), 3);
  assert.ok(r.assessed >= 3);
  await policy({ capPaise: 100_000 });
});

test('paid fees are never assessed, and a late fee voids if the student pays just before it is booked', async () => {
  const fee = await createFee(2, DUE);
  await payAll(sessions[2], fee);
  await lateFees.assessCollege(await college(), addDays(DUE, 10));
  assert.equal(await M.LateFeeAssessment.countDocuments({ assignment: fee._id }), 0);
  assert.equal((await M.FeeAssignment.findById(fee._id)).totalPayablePaise, FEE);

  // an assessment that lost the race: the fee is fully paid by the time it is booked
  const raced = await M.LateFeeAssessment.create({ college: ctx.college._id, student: fee.student, assignment: fee._id, periodKey: 'p9', amountPaise: 50_000 });
  assert.equal(await lateFees.book(raced), 'void', 'booking onto a settled fee is refused');
  const after = await M.LateFeeAssessment.findById(raced._id);
  assert.deepEqual([after.applied, after.status], [false, 'void']);
  assert.equal((await M.FeeAssignment.findById(fee._id)).totalPayablePaise, FEE, 'nothing added to a settled fee');
});

test('percentage late fees use the outstanding balance when assessed', async () => {
  await policy({ mode: 'percent', percentBp: 1000, period: 'once', capPaise: 0, graceDays: 0 });
  const fee = await createFee(3, DUE, 2_000_000);
  await lateFees.assessCollege(await college(), addDays(DUE, 5));
  const row = await M.LateFeeAssessment.findOne({ assignment: fee._id });
  assert.equal(row.amountPaise, 200_000, '10% of 20,000');
  assert.equal((await lateFees.assessCollege(await college(), addDays(DUE, 60))).assessed, 0 + 0, 'a once-only policy does not repeat');
  assert.equal(await M.LateFeeAssessment.countDocuments({ assignment: fee._id }), 1);
});

test('waivers need latefees.waive, reduce the payable amount once, and are refused once the student has paid', async () => {
  const fee = await M.FeeAssignment.findOne({ student: ctx.students[3].profile._id, semesterNumber: { $gte: 1 }, appliedLateFees: { $exists: true, $ne: [] } });
  const row = await M.LateFeeAssessment.findOne({ assignment: fee._id });
  assert.equal((await sessions[0].post(`/api/admin/fees/late-fees/${row._id}/waive`, {})).status, 403);
  assert.equal((await teacher.post(`/api/admin/fees/late-fees/${row._id}/waive`, {})).status, 403);

  const results = await Promise.all([head, head, head].map(a => a.post(`/api/admin/fees/late-fees/${row._id}/waive`, { reason: 'Bank holiday delay' })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.ok(results.filter(r => r.status !== 200).every(r => r.status === 409));
  const a = await M.FeeAssignment.findById(fee._id);
  assert.equal(a.totalPayablePaise, 2_000_000, 'the waiver cancelled the fee exactly once');
  assert.equal(a.adjustments.at(-1).kind, 'concession');
  assert.ok(await M.Notification.findOne({ user: ctx.students[3].user._id, title: 'Late fee waived' }));

  // a student who already paid the late fee cannot have it waived (refund instead)
  const paidFee = await M.FeeAssignment.findOne({ student: ctx.students[0].profile._id });
  const paidRow = await M.LateFeeAssessment.findOne({ assignment: paidFee._id, status: 'assessed' });
  await payAll(sessions[0], paidFee);
  const refused = await head.post(`/api/admin/fees/late-fees/${paidRow._id}/waive`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'ALREADY_PAID');
  assert.equal((await M.LateFeeAssessment.findById(paidRow._id)).status, 'assessed', 'the failed waiver left the fee as it was');
  assert.equal((await M.FeeAssignment.findById(paidFee._id)).totalPayablePaise, paidFee.totalPayablePaise);
});

test('late fees are listed for fee staff only; the jobs for this module are registered', async () => {
  const list = await clerk.get('/api/admin/fees/late-fees?status=waived');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length >= 1 && list.body.data.every(r => r.status === 'waived'));
  assert.equal((await teacher.get('/api/admin/fees/late-fees')).status, 403);
  assert.equal((await sessions[0].get('/api/admin/fees/late-fees')).status, 403);
  const jobs = require('../../src/jobs');
  for (const name of ['late-fees', 'fee-reminders', 'refund-reconcile', 'library-reminders']) assert.ok(jobs.jobNames().includes(name), name);
  const run = await jobs.runJob('late-fees');
  assert.ok(run, 'the job runs');
});

/* ---------------------------------------------------------------- reminders */

test('fee reminders follow the college schedule and are sent once per slot', async () => {
  const due = '2026-06-10';
  const fee = await createFee(4, due);
  const dbg = async day => (await reminders.remindCollege(await college(), day)).sent;

  assert.equal(await dbg(addDays(due, -7)), 1, 'default schedule: a week before');
  assert.equal(await dbg(addDays(due, -7)), 0, 'same day again: nothing');
  assert.equal(await dbg(addDays(due, -3)), 0, 'not a scheduled day');

  assert.equal((await hod.patch('/api/admin/settings', { feeReminders: { offsetsDays: [-3, 0], repeatEveryDays: 5 } })).status, 200);
  const cfg = (await college()).settings.feeReminders;
  assert.deepEqual([cfg.enabled, cfg.repeatEveryDays, [...cfg.offsetsDays]], [true, 5, [-3, 0]]);

  assert.equal(await dbg(addDays(due, -3)), 1);
  assert.equal(await dbg(due), 1);
  assert.equal(await dbg(addDays(due, 5)), 1, 'repeat while overdue');
  assert.equal(await dbg(addDays(due, 7)), 0);
  assert.equal(await dbg(addDays(due, 10)), 1);
  const titles = (await M.Notification.find({ user: ctx.students[4].user._id, type: 'fee_reminder' }).sort({ createdAt: 1 })).map(n => n.title);
  assert.deepEqual(titles, ['Fee reminder', 'Fee reminder', 'Fee reminder', 'Fee overdue', 'Fee overdue']);

  await payAll(sessions[4], fee);
  assert.equal(await dbg(addDays(due, 15)), 0, 'a settled fee is never reminded');

  await hod.patch('/api/admin/settings', { feeReminders: { enabled: false } });
  assert.equal((await M.FeeAssignment.countDocuments({ _id: fee._id })), 1);
  assert.equal(await dbg(addDays(due, 20)), 0);
  await hod.patch('/api/admin/settings', { feeReminders: { enabled: true } });
});

/* ----------------------------------------------------------------- settings */

test('college settings: partial updates merge, unknown keys are refused, and only settings managers may change them', async () => {
  assert.equal((await teacher.patch('/api/admin/settings', { smsEnabled: true })).status, 403);
  assert.equal((await hod.patch('/api/admin/settings', { wildcard: true })).status, 400);
  assert.equal((await hod.patch('/api/admin/settings', { library: { loanDays: 9999 } })).status, 400);
  assert.equal((await hod.patch('/api/admin/settings', { library: { nonsense: 1 } })).status, 400);

  const before = (await college()).settings;
  assert.equal((await hod.patch('/api/admin/settings', { library: { loanDays: 21 }, smsEnabled: true, parentVisibility: { payments: true }, qr: { geofence: { enabled: true, lat: 30.5, lng: 76.7 } } })).status, 200);
  const s = (await college()).settings;
  assert.equal(s.library.loanDays, 21);
  assert.equal(s.library.maxActiveIssues, before.library.maxActiveIssues, 'other library settings survive');
  assert.equal(s.smsEnabled, true);
  assert.deepEqual([s.parentVisibility.payments, s.parentVisibility.attendance], [true, true]);
  assert.deepEqual([s.qr.geofence.enabled, s.qr.geofence.lat, s.qr.geofence.radiusMeters], [true, 30.5, 200]);

  assert.equal((await hod.patch('/api/admin/settings', { notifications: { announcement: { sms: true } } })).status, 200);
  assert.equal((await hod.patch('/api/admin/settings', { notifications: { announcement: { email: false } } })).status, 200);
  const ch = (await college()).settings.notifications.get('announcement');
  assert.deepEqual([ch.sms, ch.email], [true, false], 'channel overrides merge per type');
  assert.equal((await hod.patch('/api/admin/settings', { notifications: { not_a_type: { sms: true } } })).status, 400);
  assert.ok(await M.AuditLog.findOne({ action: 'settings.updated' }));
});
