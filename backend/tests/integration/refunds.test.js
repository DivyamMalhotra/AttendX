const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');
const refundService = require('../../src/services/refundService');

let ctx; let M; let hod; let clerk; let head; let teacher; let sessions;
const FEE = 1_000_000;                   // Rs 10,000
const id = x => String(x._id || x);

async function payFee(agent, assignmentId, amountPaise) {
  const order = await agent.post('/api/fees/orders', amountPaise ? { assignmentId, amountPaise } : { assignmentId });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const orderId = order.body.data.checkout.orderId;
  const sim = (await agent.post(`/api/fees/orders/${orderId}/simulate`, { outcome: 'success' })).body.data;
  const v = await agent.post(`/api/fees/orders/${orderId}/verify`, { paymentId: sim.paymentId, signature: sim.signature });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return M.Payment.findOne({ providerOrderId: orderId });
}

/** A fresh assigned fee for student i and (optionally) a verified payment of it. */
let semester = 0;
async function feeFor(i, { pay = true, amount } = {}) {
  semester += 1;
  const structure = await hod.post('/api/admin/fees/structures', {
    course: 'B.Tech', specialization: 'CSE', academicSessionId: id(ctx.academicSession), semesterNumber: semester,
    components: [{ name: 'Tuition fee', kind: 'tuition', amountPaise: FEE }], dueDate: '2031-01-01'
  });
  assert.equal(structure.status, 201, JSON.stringify(structure.body));
  await hod.post('/api/admin/fees/assign', { structureId: structure.body.data.id || structure.body.data._id, studentIds: [id(ctx.students[i].profile)] });
  const assignment = await M.FeeAssignment.findOne({ student: ctx.students[i].profile._id, semesterNumber: semester });
  const payment = pay ? await payFee(sessions[i], id(assignment), amount) : null;
  return { assignment, payment };
}
const request = (agent, paymentId, extra = {}) => agent.post('/api/admin/fees/refunds', { paymentId: id(paymentId), amountPaise: 300_000, reason: 'Course withdrawn', ...extra });
const fresh = async (M2, doc) => M2.findById(doc._id);

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'RFD1', students: 4 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  clerk = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'clerk@rfd1.edu' });
  head = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_head', email: 'head@rfd1.edu' });
  sessions = [];
  for (const s of ctx.students) sessions.push(await harness.login(creds(ctx.college, s.user)));
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('requesting a refund needs refunds.request and a verified, applied payment', async () => {
  const { assignment, payment } = await feeFor(0);
  assert.equal((await request(teacher, payment._id)).status, 403);
  assert.equal((await sessions[0].post('/api/admin/fees/refunds', { paymentId: id(payment), amountPaise: 100, reason: 'x' })).status, 403);

  const unpaid = await feeFor(1, { pay: false });
  const order = await sessions[1].post('/api/fees/orders', { assignmentId: id(unpaid.assignment) });
  const open = await M.Payment.findOne({ providerOrderId: order.body.data.checkout.orderId });
  assert.equal((await request(clerk, open._id)).body.error.code, 'NOT_REFUNDABLE');
  assert.equal((await request(clerk, payment._id, { amountPaise: 50 })).status, 400, 'below the minimum');
  assert.equal((await request(clerk, payment._id, { amountPaise: FEE + 100 })).body.error.code, 'EXCEEDS_PAID');

  const ok = await request(clerk, payment._id);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.status, 'requested');
  assert.equal((await M.Payment.findById(payment._id)).refundReservedPaise, 300_000, 'the amount is reserved at once');
  assert.equal((await M.FeeAssignment.findById(assignment._id)).paidPaise, FEE, 'but nothing moves until the gateway confirms');
});

test('the requester cannot approve; a second person approves and the simulator completes it', async () => {
  const refund = await M.Refund.findOne({ status: 'requested' });
  assert.equal((await clerk.post(`/api/admin/fees/refunds/${refund._id}/approve`, {})).status, 403, 'clerks hold refunds.request only');
  const own = await request(hod, refund.payment, { amountPaise: 100_000, reason: 'Wrong fee head' });
  assert.equal(own.status, 201);
  assert.equal((await hod.post(`/api/admin/fees/refunds/${own.body.data._id}/approve`, {})).body.error.code, 'SELF_APPROVAL');
  assert.equal((await hod.post(`/api/admin/fees/refunds/${own.body.data._id}/reject`, { note: 'Raised in error' })).status, 200, 'but a requester can withdraw it');

  const done = await head.post(`/api/admin/fees/refunds/${refund._id}/approve`, { note: 'Verified withdrawal letter' });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.status, 'completed');
  assert.equal(done.body.data.applied, true);
  assert.match(done.body.data.providerRefundId, /^rfnd_sim_/);

  const payment = await M.Payment.findById(refund.payment);
  assert.deepEqual([payment.refundedPaise, payment.refundReservedPaise], [300_000, 0]);
  const assignment = await M.FeeAssignment.findById(refund.assignment);
  assert.deepEqual([assignment.paidPaise, assignment.refundedPaise, assignment.totalPayablePaise], [FEE - 300_000, 300_000, FEE]);
  assert.equal((await head.post(`/api/admin/fees/refunds/${refund._id}/approve`, {})).status, 409, 'cannot approve twice');
  assert.equal(await M.Receipt.countDocuments({ payment: payment._id }), 1, 'the original receipt is untouched');
  assert.ok(await M.AuditLog.findOne({ action: 'refund.completed', entityId: String(refund._id) }));
});

test('students see their own refund status, never internal details', async () => {
  const mine = (await sessions[0].get('/api/fees/refunds')).body.data;
  assert.equal(mine.length, 2);
  assert.ok(mine.some(r => r.status === 'completed'));
  assert.deepEqual(Object.keys(mine[0]).sort(), ['amountPaise', 'completedAt', 'decidedAt', 'id', 'reason', 'requestedAt', 'status']);
  assert.deepEqual((await sessions[1].get('/api/fees/refunds')).body.data, []);
  assert.ok(await M.Notification.findOne({ user: ctx.students[0].user._id, title: 'Refund completed' }));
  const tl = (await sessions[0].get('/api/student/timeline?categories=payments')).body.data.events;
  assert.ok(tl.some(e => e.type === 'refund'));
});

test('concurrent requests can never reserve more than the payment amount', async () => {
  const { payment } = await feeFor(2);
  const results = await Promise.all(Array.from({ length: 6 }, () => request(clerk, payment._id, { amountPaise: 400_000 })));
  assert.equal(results.filter(r => r.status === 201).length, 2, 'only 2 x 4,000 fit into 10,000');
  assert.ok(results.filter(r => r.status !== 201).every(r => r.body.error.code === 'REFUND_EXCEEDS_PAYMENT'));
  assert.equal((await M.Payment.findById(payment._id)).refundReservedPaise, 800_000);
});

test('rejecting hands the reserved money back; double decisions are refused', async () => {
  const pending = await M.Refund.find({ student: ctx.students[2].profile._id, status: 'requested' });
  const [a, b] = pending;
  assert.equal((await head.post(`/api/admin/fees/refunds/${a._id}/reject`, { note: 'Not eligible' })).status, 200);
  assert.equal((await head.post(`/api/admin/fees/refunds/${a._id}/reject`, {})).status, 409);
  assert.equal((await head.post(`/api/admin/fees/refunds/${a._id}/approve`, {})).status, 409);
  assert.equal((await M.Payment.findById(a.payment)).refundReservedPaise, 400_000);
  assert.ok(await M.Notification.findOne({ user: ctx.students[2].user._id, title: 'Refund request declined' }));

  // the freed 4,000 can be requested again
  assert.equal((await request(clerk, a.payment, { amountPaise: 400_000 })).status, 201);
  assert.ok(b);
});

test('two approvers pressing approve together refund exactly once', async () => {
  const { payment, assignment } = await feeFor(3);
  const refund = (await request(clerk, payment._id, { amountPaise: 500_000 })).body.data;
  const head2 = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_head', email: 'head2@rfd1.edu' });
  const res = await Promise.all([head, head2, head, head2].map(a => a.post(`/api/admin/fees/refunds/${refund._id}/approve`, {})));
  assert.equal(res.filter(r => r.status === 200).length, 1);
  assert.ok(res.filter(r => r.status !== 200).every(r => r.status === 409));
  const a = await M.FeeAssignment.findById(assignment._id);
  assert.equal(a.paidPaise, FEE - 500_000);
  assert.equal(a.appliedRefunds.length, 1);
  assert.equal((await M.Payment.findById(payment._id)).refundedPaise, 500_000);
});

test('"reduce the fee too" keeps the student\'s outstanding balance at zero after refunding an over-collection', async () => {
  const { payment, assignment } = await feeFor(0);
  const refund = (await request(clerk, payment._id, { amountPaise: 200_000, reduceFee: true, reason: 'Scholarship granted after payment' })).body.data;
  await head.post(`/api/admin/fees/refunds/${refund._id}/approve`, {});
  const a = await M.FeeAssignment.findById(assignment._id);
  assert.deepEqual([a.totalPayablePaise, a.paidPaise], [FEE - 200_000, FEE - 200_000]);
  assert.equal(a.adjustments.at(-1).label, 'Refund adjustment');
  const s = (await sessions[0].get('/api/fees/summary')).body.data.semesters.find(x => x.id === id(assignment));
  assert.equal(s.outstandingPaise, 0);
});

/* ---- Razorpay behaviour with a stand-in gateway ---- */

let gatewayRefunds = 0;
function gatewayFor() {
  const state = { refunds: new Map(), byKey: new Map(), mode: 'ok', calls: 0 };
  state.fetchImpl = async (url, opts = {}) => {
    const path = url.replace('https://api.razorpay.com/v1', '');
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    let m = /^\/payments\/(.+)\/refund$/.exec(path);
    if (m && opts.method === 'POST') {
      state.calls += 1;
      if (state.mode === 'down') throw new Error('network down');
      if (state.mode === 'reject') return { ok: false, status: 400, json: async () => ({ error: { description: 'Refund amount exceeds captured amount' } }) };
      const key = opts.headers['X-Refund-Idempotency'];
      assert.ok(key, 'every refund call carries an idempotency key');
      if (!state.byKey.has(key)) {
        const b = JSON.parse(opts.body);
        const r = { id: `rfnd_RZ${++gatewayRefunds}`, payment_id: m[1], amount: b.amount, status: state.mode === 'pending' ? 'pending' : 'processed' };
        state.refunds.set(r.id, r); state.byKey.set(key, r);
      }
      return ok(state.byKey.get(key));
    }
    m = /^\/refunds\/(.+)$/.exec(path);
    if (m) return ok(state.refunds.get(m[1]));
    throw new Error(`unexpected gateway call ${path}`);
  };
  return state;
}

test('Razorpay refunds: idempotent gateway calls, pending refunds settle via webhook, and webhooks are signed', async () => {
  const providers = require('../../src/services/payments');
  const { createRazorpayProvider } = require('../../src/services/payments/razorpayProvider');
  const KEY = { keyId: 'rzp_test_unit', keySecret: 'k', webhookSecret: 'whsec' };
  const gateway = gatewayFor();
  const original = providers.getProvider();
  const { payment } = await feeFor(1);              // paid through the simulator before the gateway is swapped in
  providers.setProviderForTests(createRazorpayProvider(KEY, gateway.fetchImpl));
  try {
    // the payment was made through the simulator, so the Razorpay gateway must refuse to refund it
    const wrong = (await request(clerk, payment._id)).body.data;
    const refused = await head.post(`/api/admin/fees/refunds/${wrong._id}/approve`, {});
    assert.equal(refused.body.data.status, 'failed');
    assert.match(refused.body.data.failureReason, /simulator/);
    assert.equal((await M.Payment.findById(payment._id)).refundReservedPaise, 0, 'a failed refund releases its reservation');
    assert.equal(gateway.calls, 0);

    // make a Razorpay-style payment record to refund
    const rz = await M.Payment.create({
      college: ctx.college._id, student: payment.student, rollNoSnapshot: payment.rollNoSnapshot, assignment: payment.assignment, amountPaise: 400_000,
      provider: 'razorpay', providerOrderId: 'order_RZ_t1', providerPaymentId: 'pay_RZ_t1', status: 'success', applied: true, paidAt: new Date()
    });
    await M.FeeAssignment.updateOne({ _id: payment.assignment }, { $inc: { paidPaise: 400_000, totalPayablePaise: 400_000 } });

    gateway.mode = 'pending';
    const r1 = (await request(clerk, rz._id, { amountPaise: 400_000 })).body.data;
    const processing = await head.post(`/api/admin/fees/refunds/${r1._id}/approve`, {});
    assert.equal(processing.body.data.status, 'processing');
    assert.equal(processing.body.data.providerRefundId, 'rfnd_RZ1');
    assert.equal(gateway.calls, 1);

    // an unsigned or wrongly signed webhook is rejected
    const evt = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_RZ1', payment_id: 'pay_RZ_t1', amount: 400_000 } } } });
    const post = sig => harness.supertest().post('/api/fees/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', 'evt_r1').send(evt);
    assert.equal((await post('0'.repeat(64))).status, 400);
    assert.equal((await M.Refund.findById(r1._id)).status, 'processing');

    const sig = crypto.createHmac('sha256', KEY.webhookSecret).update(evt).digest('hex');
    const sent = await Promise.all([post(sig), post(sig), post(sig)]);
    assert.ok(sent.every(r => r.status === 200));
    const done = await M.Refund.findById(r1._id);
    assert.equal(done.status, 'completed');
    assert.equal((await M.Payment.findById(rz._id)).refundedPaise, 400_000, 'three deliveries booked the refund once');
    assert.equal((await M.Payment.findById(rz._id)).appliedRefunds.length, 1);
  } finally {
    providers.setProviderForTests(original);
  }
});

test('gateway outages leave the refund processing and the reconciliation job finishes it without refunding twice', async () => {
  const providers = require('../../src/services/payments');
  const { createRazorpayProvider } = require('../../src/services/payments/razorpayProvider');
  const KEY = { keyId: 'rzp_test_unit', keySecret: 'k', webhookSecret: 'whsec' };
  const gateway = gatewayFor();
  const original = providers.getProvider();
  providers.setProviderForTests(createRazorpayProvider(KEY, gateway.fetchImpl));
  try {
    const base = await feeFor(2, { pay: false });
    const rz = await M.Payment.create({
      college: ctx.college._id, student: base.assignment.student, rollNoSnapshot: 'X', assignment: base.assignment._id, amountPaise: 600_000,
      provider: 'razorpay', providerOrderId: 'order_RZ_t2', providerPaymentId: 'pay_RZ_t2', status: 'success', applied: true, paidAt: new Date()
    });
    await M.FeeAssignment.updateOne({ _id: base.assignment._id }, { $inc: { paidPaise: 600_000 } });

    gateway.mode = 'down';
    const r = (await request(clerk, rz._id, { amountPaise: 600_000 })).body.data;
    const out = await head.post(`/api/admin/fees/refunds/${r._id}/approve`, {});
    assert.equal(out.body.data.status, 'processing', 'an unreachable gateway is not a failure');
    assert.equal((await M.Payment.findById(rz._id)).refundReservedPaise, 600_000, 'the money stays reserved');

    gateway.mode = 'ok';
    assert.deepEqual(await refundService.reconcile(), { touched: 0 }, 'the claim has not expired yet, so nothing is retried early');
    await M.Refund.updateOne({ _id: r._id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.equal((await refundService.reconcile()).touched, 1);
    assert.equal((await M.Refund.findById(r._id)).status, 'completed');
    assert.equal(gateway.refunds.size, 1);
    await refundService.reconcile();
    assert.equal((await M.Payment.findById(rz._id)).refundedPaise, 600_000);

    // a hard rejection fails the refund; an administrator can retry it with the same idempotency key
    gateway.mode = 'reject';
    const pay2 = await M.Payment.create({
      college: ctx.college._id, student: base.assignment.student, rollNoSnapshot: 'X', assignment: base.assignment._id, amountPaise: 100_000,
      provider: 'razorpay', providerOrderId: 'order_RZ_t3', providerPaymentId: 'pay_RZ_t3', status: 'success', applied: true, paidAt: new Date()
    });
    await M.FeeAssignment.updateOne({ _id: base.assignment._id }, { $inc: { paidPaise: 100_000 } });
    const r2 = (await request(clerk, pay2._id, { amountPaise: 100_000 })).body.data;
    const bad = await head.post(`/api/admin/fees/refunds/${r2._id}/approve`, {});
    assert.equal(bad.body.data.status, 'failed');
    assert.equal((await M.Payment.findById(pay2._id)).refundReservedPaise, 0);
    gateway.mode = 'ok';
    assert.equal((await clerk.post(`/api/admin/fees/refunds/${r2._id}/retry`, {})).status, 403);
    const again = await head.post(`/api/admin/fees/refunds/${r2._id}/retry`, {});
    assert.equal(again.body.data.status, 'completed');
    assert.equal((await M.Payment.findById(pay2._id)).refundedPaise, 100_000);
  } finally {
    providers.setProviderForTests(original);
  }
});

test('admins can list refunds filtered by status; other roles cannot', async () => {
  const completed = (await hod.get('/api/admin/fees/refunds?status=completed')).body;
  assert.ok(completed.data.length >= 3 && completed.data.every(r => r.status === 'completed'));
  assert.equal((await clerk.get('/api/admin/fees/refunds')).status, 200);
  assert.equal((await teacher.get('/api/admin/fees/refunds')).status, 403);
  assert.equal((await hod.get('/api/admin/fees/refunds?status=bogus')).status, 400);
});
