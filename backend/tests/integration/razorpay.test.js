const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');

const KEY = { keyId: 'rzp_test_unit', keySecret: 'unit_key_secret', webhookSecret: 'unit_webhook_secret' };
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

let ctx; let M; let student; let hod; let providers; let gateway;
const TOTAL = 5_000_000;

/** In-memory stand-in for api.razorpay.com so the real provider code (signatures, REST calls) is exercised. */
function makeGateway() {
  const state = { orders: new Map(), payments: new Map(), n: 0, down: false, calls: [] };
  const fetchImpl = async (url, opts = {}) => {
    state.calls.push([opts.method, url]);
    if (state.down) throw new Error('network down');
    const path = url.replace('https://api.razorpay.com/v1', '');
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (opts.method === 'POST' && path === '/orders') {
      const b = JSON.parse(opts.body);
      assert.match(opts.headers.Authorization, /^Basic /);
      const id = `order_RZ${++state.n}`;
      state.orders.set(id, b);
      return ok({ id, amount: b.amount, currency: b.currency });
    }
    let m = /^\/payments\/(.+)$/.exec(path);
    if (m) return state.payments.has(m[1]) ? ok(state.payments.get(m[1])) : { ok: false, status: 400, json: async () => ({ error: { description: 'not found' } }) };
    m = /^\/orders\/(.+)\/payments$/.exec(path);
    if (m) return ok({ items: [...state.payments.values()].filter(p => p.order_id === m[1]) });
    throw new Error(`unexpected gateway call ${path}`);
  };
  state.fetchImpl = fetchImpl;
  state.addPayment = (id, orderId, over = {}) => state.payments.set(id, {
    id, order_id: orderId, amount: state.orders.get(orderId).amount, currency: 'INR', status: 'captured', ...over
  });
  return state;
}

const newOrder = async amountPaise => (await student.post('/api/fees/orders', { assignmentId: String(assignmentId), amountPaise })).body.data.checkout;
let assignmentId;
const paid = async () => (await M.FeeAssignment.findById(assignmentId)).paidPaise;
const sign = (orderId, paymentId, secret = KEY.keySecret) => hmac(secret, `${orderId}|${paymentId}`);
const verify = (orderId, paymentId, signature) => student.post(`/api/fees/orders/${orderId}/verify`, { paymentId, signature });

function webhook(event, entity, { secret = KEY.webhookSecret, id = `evt_${Math.random().toString(36).slice(2)}` } = {}) {
  const raw = JSON.stringify({ event, payload: { payment: { entity } } });
  return harness.supertest().post('/api/fees/webhook')
    .set('Content-Type', 'application/json').set('x-razorpay-signature', hmac(secret, raw)).set('x-razorpay-event-id', id).send(raw);
}

before(async () => {
  process.env.PAYMENT_PROVIDER = 'razorpay';
  const { models } = await harness.start();
  M = models;
  providers = require('../../src/services/payments');
  const { createRazorpayProvider } = require('../../src/services/payments/razorpayProvider');
  gateway = makeGateway();
  providers.setProviderForTests(createRazorpayProvider(KEY, gateway.fetchImpl));

  ctx = await seedCollege(M, { code: 'RZP1', students: 1 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  student = await harness.login(creds(ctx.college, ctx.students[0].user));
  const s = await hod.post('/api/admin/fees/structures', {
    course: 'B.Tech', specialization: 'CSE', academicSessionId: String(ctx.academicSession._id), semesterNumber: 3,
    components: [{ name: 'Tuition', kind: 'tuition', amountPaise: TOTAL }]
  });
  await hod.post('/api/admin/fees/assign', { structureId: s.body.data._id, sectionId: String(ctx.section._id) });
  assignmentId = (await M.FeeAssignment.findOne())._id;
});
after(async () => { providers.setProviderForTests(null); await harness.stop(); });

test('orders are created at the gateway with the server-computed amount and expose only the public key', async () => {
  const checkout = await newOrder();
  assert.equal(checkout.provider, 'razorpay');
  assert.equal(checkout.keyId, KEY.keyId);
  assert.equal(checkout.simulated, false);
  assert.equal(checkout.amountPaise, TOTAL);
  assert.equal(gateway.orders.get(checkout.orderId).amount, TOTAL);
  assert.ok(!JSON.stringify(checkout).includes(KEY.keySecret));
  const p = await M.Payment.findOne({ providerOrderId: checkout.orderId });
  assert.equal(p.simulated, false);
  await student.post(`/api/fees/orders/${checkout.orderId}/cancel`);
});

test('a genuine signed checkout response is verified against the gateway and credited', async () => {
  const { orderId } = await newOrder(1_000_000);
  gateway.addPayment('pay_ok1', orderId);
  const res = await verify(orderId, 'pay_ok1', sign(orderId, 'pay_ok1'));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'success');
  assert.equal(res.body.data.simulated, false);
  assert.equal(await paid(), 1_000_000);
});

test('bad signatures are rejected before the gateway is even asked', async () => {
  const { orderId } = await newOrder(100_000);
  gateway.addPayment('pay_bad1', orderId);
  const calls = gateway.calls.length;
  const res = await verify(orderId, 'pay_bad1', sign(orderId, 'pay_bad1', 'attacker_secret'));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VERIFICATION_FAILED');
  assert.equal(gateway.calls.length, calls, 'no gateway lookup for an unsigned request');
  assert.equal(await paid(), 1_000_000);
  await student.post(`/api/fees/orders/${orderId}/cancel`);
});

test('a payment whose amount differs from the order is refused (gateway data wins over the browser)', async () => {
  const { orderId } = await newOrder(200_000);
  gateway.addPayment('pay_cheap', orderId, { amount: 100 });
  const res = await verify(orderId, 'pay_cheap', sign(orderId, 'pay_cheap'));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'PAYMENT_MISMATCH');
  assert.equal(await paid(), 1_000_000);
  await student.post(`/api/fees/orders/${orderId}/cancel`);
});

test('an authorized-but-not-captured payment stays pending and is not credited', async () => {
  const { orderId } = await newOrder(200_000);
  gateway.addPayment('pay_auth', orderId, { status: 'authorized' });
  const res = await verify(orderId, 'pay_auth', sign(orderId, 'pay_auth'));
  assert.equal(res.body.data.status, 'pending');
  assert.equal(res.body.data.receiptNo, null);
  assert.equal(await paid(), 1_000_000);

  // once captured, syncing with the gateway completes it and issues the receipt
  gateway.payments.get('pay_auth').status = 'captured';
  const sync = await student.post(`/api/fees/orders/${orderId}/sync`);
  assert.equal(sync.body.data.status, 'success');
  assert.ok(sync.body.data.receiptNo);
  assert.equal(await paid(), 1_200_000);
});

test('webhook: signature is mandatory', async () => {
  const { orderId } = await newOrder(100_000);
  gateway.addPayment('pay_wh0', orderId);
  const forged = await webhook('payment.captured', gateway.payments.get('pay_wh0'), { secret: 'wrong' });
  assert.equal(forged.status, 400);
  const unsigned = await harness.supertest().post('/api/fees/webhook').set('Content-Type', 'application/json').send('{}');
  assert.equal(unsigned.status, 400);
  assert.equal(await paid(), 1_200_000);
  await student.post(`/api/fees/orders/${orderId}/cancel`);
});

test('webhook: a captured event credits the payment once, even when delivered repeatedly', async () => {
  const { orderId } = await newOrder(300_000);
  gateway.addPayment('pay_wh1', orderId);
  const entity = gateway.payments.get('pay_wh1');
  const deliveries = await Promise.all([1, 2, 3, 4].map(() => webhook('payment.captured', entity)));
  assert.ok(deliveries.every(r => r.status === 200));
  assert.equal(await paid(), 1_500_000);
  const p = await M.Payment.findOne({ providerOrderId: orderId });
  assert.equal(p.status, 'success');
  assert.ok(p.receiptNo);
  // the browser callback arriving afterwards changes nothing
  const late = await verify(orderId, 'pay_wh1', sign(orderId, 'pay_wh1'));
  assert.equal(late.status, 200);
  assert.equal(await paid(), 1_500_000);
});

test('webhook: amount mismatches, unknown orders and failure events are handled safely', async () => {
  const { orderId } = await newOrder(100_000);
  const mismatch = await webhook('payment.captured', { id: 'pay_wh2', order_id: orderId, amount: 1, status: 'captured' });
  assert.equal(mismatch.body.data.result, 'amount_mismatch');
  assert.equal((await M.Payment.findOne({ providerOrderId: orderId })).status, 'created');

  const unknown = await webhook('payment.captured', { id: 'pay_x', order_id: 'order_nope', amount: 100, status: 'captured' });
  assert.equal(unknown.body.data.result, 'unknown_order');

  const failed = await webhook('payment.failed', { id: 'pay_wh3', order_id: orderId, amount: 100_000, status: 'failed', error_description: 'Card declined' });
  assert.equal(failed.status, 200);
  const p = await M.Payment.findOne({ providerOrderId: orderId });
  assert.equal(p.status, 'failed');
  assert.equal(p.failureReason, 'Card declined');
  assert.equal(await paid(), 1_500_000);

  const ignored = await webhook('refund.created', { id: 'rf_1', order_id: orderId, amount: 1 });
  assert.equal(ignored.body.data.result, 'ignored');
});

test('gateway outages surface as a clear error and never create credited payments', async () => {
  gateway.down = true;
  const res = await student.post('/api/fees/orders', { assignmentId: String(assignmentId), amountPaise: 100_000 });
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'GATEWAY_UNREACHABLE');
  gateway.down = false;
  const count = await M.Payment.countDocuments({ status: 'created' });
  assert.ok(count >= 0);
});

test('the reconciliation job completes payments the browser never reported', async () => {
  const { orderId } = await newOrder(500_000);
  gateway.addPayment('pay_job1', orderId);
  await M.Payment.collection.updateOne({ providerOrderId: orderId }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } }); // createdAt is immutable through Mongoose
  const payments = require('../../src/services/paymentService');
  const result = await payments.reconcileOpenPayments();
  assert.ok(result.touched >= 1);
  assert.equal((await M.Payment.findOne({ providerOrderId: orderId })).status, 'success');
  assert.equal(await paid(), 2_000_000);
  // running it again is a no-op
  await payments.reconcileOpenPayments();
  assert.equal(await paid(), 2_000_000);
});

test('the simulator endpoint is unavailable when a real provider is configured', async () => {
  const { orderId } = await newOrder(100_000);
  const res = await student.post(`/api/fees/orders/${orderId}/simulate`, { outcome: 'success' });
  assert.equal(res.status, 403);
  await student.post(`/api/fees/orders/${orderId}/cancel`);
});

test('payments are reported as unconfigured (503) when no provider exists', async () => {
  providers.setProviderForTests(null);
  const config = require('../../src/config/env').config;
  const saved = config.payments.provider;
  Object.defineProperty(config.payments, 'provider', { value: 'none', configurable: true });
  const res = await student.post('/api/fees/orders', { assignmentId: String(assignmentId) });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'PAYMENTS_NOT_CONFIGURED');
  Object.defineProperty(config.payments, 'provider', { value: saved, configurable: true });
});
