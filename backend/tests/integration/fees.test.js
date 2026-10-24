const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');

let ctx; let M; let hod; let a; let b; let teacher;
const TOTAL = 12_500_000;   // ₹1,25,000 in paise

const structureBody = (over = {}) => ({
  course: 'B.Tech', specialization: 'CSE', academicSessionId: String(ctx.academicSession._id), semesterNumber: 3,
  components: [
    { name: 'Tuition fee', kind: 'tuition', amountPaise: 10_000_000 },
    { name: 'Examination fee', kind: 'examination', amountPaise: 1_500_000 },
    { name: 'Registration fee', kind: 'registration', amountPaise: 1_000_000 }
  ],
  dueDate: '2030-01-01', ...over
});

const summary = async agent => (await agent.get('/api/fees/summary')).body.data;
const current = async agent => (await summary(agent)).current;
const order = (agent, assignmentId, amountPaise) => agent.post('/api/fees/orders', amountPaise === undefined ? { assignmentId } : { assignmentId, amountPaise });
async function pay(agent, orderId, outcome = 'success') {
  const sim = await agent.post(`/api/fees/orders/${orderId}/simulate`, { outcome });
  assert.equal(sim.status, 200, JSON.stringify(sim.body));
  return agent.post(`/api/fees/orders/${orderId}/verify`, { paymentId: sim.body.data.paymentId, signature: sim.body.data.signature });
}

before(async () => {
  const { models } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'FEE1', students: 3 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  a = await harness.login(creds(ctx.college, ctx.students[0].user));
  b = await harness.login(creds(ctx.college, ctx.students[1].user));
});
after(() => harness.stop());

test('only administrators can manage fee structures', async () => {
  assert.equal((await a.post('/api/admin/fees/structures', structureBody())).status, 403);
  assert.equal((await teacher.post('/api/admin/fees/structures', structureBody())).status, 403);
  const res = await hod.post('/api/admin/fees/structures', structureBody());
  assert.equal(res.status, 201);
  assert.equal(res.body.data.totalPaise, TOTAL, 'total is computed by the server from the components');
  assert.equal((await hod.post('/api/admin/fees/structures', structureBody())).status, 409);
  assert.equal((await hod.post('/api/admin/fees/structures', structureBody({ semesterNumber: 4, components: [{ name: 'X', amountPaise: 0 }] }))).status, 400);
});

test('students see no fees until a structure is assigned', async () => {
  const s = await summary(a);
  assert.equal(s.current, null);
  assert.equal(s.semesters.length, 0);
});

test('assigning to a section creates per-student fee records; repeating it never duplicates or overwrites', async () => {
  const structure = await M.FeeStructure.findOne();
  const res = await hod.post('/api/admin/fees/assign', { structureId: String(structure._id), sectionId: String(ctx.section._id) });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.data, { created: 3, skipped: 0 });
  const again = await hod.post('/api/admin/fees/assign', { structureId: String(structure._id), sectionId: String(ctx.section._id) });
  assert.deepEqual(again.body.data, { created: 0, skipped: 3 });
  assert.equal(await M.FeeAssignment.countDocuments(), 3);
});

test('a structure for a different course cannot be assigned to this section', async () => {
  const other = await hod.post('/api/admin/fees/structures', structureBody({ course: 'MBA', specialization: '', semesterNumber: 1 }));
  const res = await hod.post('/api/admin/fees/assign', { structureId: other.body.data._id, sectionId: String(ctx.section._id) });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'COURSE_MISMATCH');
});

test('the dashboard shows the student\'s real assigned fee, with breakdown and status', async () => {
  const cur = await current(a);
  assert.equal(cur.totalPayablePaise, TOTAL);
  assert.equal(cur.paidPaise, 0);
  assert.equal(cur.outstandingPaise, TOTAL);
  assert.equal(cur.status, 'unpaid');
  assert.equal(cur.academicSession.name, '2026-27');
  assert.deepEqual(cur.components.map(c => c.name), ['Tuition fee', 'Examination fee', 'Registration fee']);
  const s = await summary(a);
  assert.equal(s.student.rollNo, ctx.students[0].profile.rollNo);
  assert.equal(s.payments.simulated, true);
});

test('concessions reduce what is payable and are recorded as adjustments', async () => {
  const id = (await current(b)).id;
  const res = await hod.post(`/api/admin/fees/assignments/${id}/adjust`, { kind: 'concession', label: 'Merit scholarship', amountPaise: 500_000 });
  assert.equal(res.status, 200);
  const cur = await current(b);
  assert.equal(cur.grossPaise, TOTAL);
  assert.equal(cur.totalPayablePaise, TOTAL - 500_000);
  assert.equal(cur.adjustments[0].label, 'Merit scholarship');
  assert.equal((await a.post(`/api/admin/fees/assignments/${id}/adjust`, { kind: 'concession', label: 'x', amountPaise: 100 })).status, 403);
});

test('students cannot see or pay another student\'s fee', async () => {
  const bId = (await current(b)).id;
  assert.equal((await a.get(`/api/fees/assignments/${bId}`)).status, 404);
  assert.equal((await order(a, bId)).status, 404);
});

test('payment amounts are decided by the server and cannot be manipulated from the browser', async () => {
  const id = (await current(a)).id;
  assert.equal((await order(a, id, TOTAL + 100)).body.error.code, 'EXCEEDS_OUTSTANDING');
  assert.equal((await order(a, id, 50)).status, 400);
  assert.equal((await order(a, id, -5000)).status, 400);
  assert.equal((await order(a, id, 1000.5)).status, 400);
  const r = await a.post('/api/fees/orders', { assignmentId: id, amountPaise: 'free' });
  assert.equal(r.status, 400);
  // extra fields such as status / paid amounts are simply ignored
  const ok = await a.post('/api/fees/orders', { assignmentId: id, status: 'success', paidPaise: TOTAL, totalPayablePaise: 1 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.checkout.amountPaise, TOTAL, 'full outstanding amount computed server side');
  assert.equal((await current(a)).paidPaise, 0, 'creating an order never changes the balance');
  await a.post(`/api/fees/orders/${ok.body.data.checkout.orderId}/cancel`);
});

test('partial payments reduce the balance and the next order is only for the remainder', async () => {
  const id = (await current(a)).id;
  const o = await order(a, id, 7_500_000);
  assert.equal(o.body.data.checkout.amountPaise, 7_500_000);
  const v = await pay(a, o.body.data.checkout.orderId);
  assert.equal(v.status, 200);
  assert.equal(v.body.data.status, 'success');
  assert.match(v.body.data.receiptNo, /^RCP-\d{4}-\d{6}$/);
  const cur = await current(a);
  assert.deepEqual([cur.paidPaise, cur.outstandingPaise, cur.status], [7_500_000, 5_000_000, 'partial']);

  const next = await a.post('/api/fees/orders', { assignmentId: id });
  assert.equal(next.body.data.checkout.amountPaise, 5_000_000, 'only the outstanding amount is charged');
  assert.equal((await order(a, id, 5_000_100)).body.error.code, 'EXCEEDS_OUTSTANDING');
  await a.post(`/api/fees/orders/${next.body.data.checkout.orderId}/cancel`);
});

test('verifying the same payment repeatedly (or concurrently) credits it exactly once', async () => {
  const id = (await current(a)).id;
  const o = await order(a, id, 1_000_000);
  const orderId = o.body.data.checkout.orderId;
  const sim = (await a.post(`/api/fees/orders/${orderId}/simulate`, { outcome: 'success' })).body.data;
  const body = { paymentId: sim.paymentId, signature: sim.signature };
  const results = await Promise.all(Array.from({ length: 8 }, () => a.post(`/api/fees/orders/${orderId}/verify`, body)));
  assert.ok(results.every(r => r.status === 200 && r.body.data.status === 'success'), JSON.stringify(results.map(r => [r.status, r.body])));
  assert.equal((await current(a)).paidPaise, 8_500_000, '7,500,000 + 1,000,000 once');
  assert.equal(await M.Receipt.countDocuments({ payment: (await M.Payment.findOne({ providerOrderId: orderId }))._id }), 1);
  assert.equal(await M.Payment.countDocuments({ providerOrderId: orderId }), 1);
});

test('forged or mismatched verification is rejected and changes nothing', async () => {
  const id = (await current(a)).id;
  const o = await order(a, id, 100_000);
  const orderId = o.body.data.checkout.orderId;
  const sim = (await a.post(`/api/fees/orders/${orderId}/simulate`, { outcome: 'success' })).body.data;
  const bad = await a.post(`/api/fees/orders/${orderId}/verify`, { paymentId: sim.paymentId, signature: 'a'.repeat(64) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VERIFICATION_FAILED');
  const forgedId = await a.post(`/api/fees/orders/${orderId}/verify`, { paymentId: 'pay_sim_forged12345', signature: sim.signature });
  assert.equal(forgedId.status, 400);
  assert.equal((await M.Payment.findOne({ providerOrderId: orderId })).status, 'created');
  assert.equal(await M.Receipt.countDocuments({ payment: (await M.Payment.findOne({ providerOrderId: orderId }))._id }), 0);
  // another student cannot complete my order even with a valid signature
  assert.equal((await b.post(`/api/fees/orders/${orderId}/verify`, { paymentId: sim.paymentId, signature: sim.signature })).status, 404);
  await a.post(`/api/fees/orders/${orderId}/cancel`);
});

test('failed, pending and cancelled payments never reduce the balance or produce a receipt', async () => {
  const id = (await current(a)).id;
  const before = (await current(a)).paidPaise;

  const failed = await order(a, id, 100_000);
  const f = await pay(a, failed.body.data.checkout.orderId, 'failure');
  assert.equal(f.status, 200);
  assert.equal(f.body.data.status, 'failed');
  assert.equal(f.body.data.receiptNo, null);

  const pending = await order(a, id, 100_000);
  const p = await pay(a, pending.body.data.checkout.orderId, 'authorized');
  assert.equal(p.body.data.status, 'pending');

  const cancelled = await order(a, id, 100_000);
  const c = await a.post(`/api/fees/orders/${cancelled.body.data.checkout.orderId}/cancel`);
  assert.equal(c.body.data.status, 'cancelled');

  assert.equal((await current(a)).paidPaise, before);
  const history = (await a.get('/api/fees/history')).body.data.transactions;
  for (const status of ['failed', 'pending', 'cancelled']) {
    const t = history.find(x => x.status === status);
    assert.ok(t, status);
    assert.equal(t.receiptId, null);
  }
  // a cancelled attempt can no longer be turned into a success by replaying its signature
  const sim = (await a.post(`/api/fees/orders/${cancelled.body.data.checkout.orderId}/simulate`, { outcome: 'success' })).body.data;
  const late = await a.post(`/api/fees/orders/${cancelled.body.data.checkout.orderId}/verify`, { paymentId: sim.paymentId, signature: sim.signature });
  assert.equal(late.status, 200, 'money that really was captured is still recorded');
  assert.equal(late.body.data.status, 'success');
  assert.equal((await current(a)).paidPaise, before + 100_000);
});

test('two payments cannot over-collect: the surplus is flagged for review and gets no receipt', async () => {
  const id = (await current(a)).id;
  const out = (await current(a)).outstandingPaise;
  const o1 = await order(a, id);
  const o2 = await order(a, id);
  assert.equal(o1.body.data.checkout.amountPaise, out);
  assert.equal((await pay(a, o1.body.data.checkout.orderId)).body.data.status, 'success');
  const second = await pay(a, o2.body.data.checkout.orderId);
  assert.equal(second.body.data.status, 'success');
  assert.equal(second.body.data.needsReview, true);
  assert.equal(second.body.data.receiptNo, null);
  const cur = await current(a);
  assert.equal(cur.paidPaise, TOTAL, 'never above the payable amount');
  assert.equal(cur.status, 'paid');
  assert.equal((await order(a, id)).body.error.code, 'ALREADY_PAID');
  const summary = (await hod.get('/api/admin/fees/summary')).body.data;
  assert.equal(summary.needsReview, 1);
});

test('receipts: generated for verified payments, downloadable as PDF, and private to the owner', async () => {
  const history = (await a.get('/api/fees/history')).body.data.transactions;
  const ok = history.find(t => t.status === 'success' && t.receiptId);
  assert.ok(ok);
  const pdf = await a.get(`/api/fees/receipts/${ok.receiptId}/pdf`).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
  assert.match(pdf.headers['content-disposition'], /receipt-RCP-/);

  assert.equal((await b.get(`/api/fees/receipts/${ok.receiptId}/pdf`)).status, 404, 'another student cannot download it');
  assert.equal((await hod.get(`/api/admin/fees/receipts/${ok.receiptId}/pdf`)).status, 200);
  assert.equal((await teacher.get(`/api/admin/fees/receipts/${ok.receiptId}/pdf`)).status, 403);
  assert.equal((await a.get('/api/fees/receipts/64b7f0f0f0f0f0f0f0f0f0f0/pdf')).status, 404);
  assert.equal((await a.get('/api/fees/receipts/not-an-id/pdf')).status, 400);

  const receipt = await M.Receipt.findById(ok.receiptId);
  assert.equal(receipt.snapshot.simulated, true, 'simulated payments are clearly marked on the receipt');
  assert.equal(receipt.snapshot.student.rollNo, ctx.students[0].profile.rollNo);
  assert.equal(receipt.snapshot.fee.totalPayablePaise, TOTAL);
});

test('payment history lists every attempt plus per-semester totals from the database', async () => {
  const h = (await a.get('/api/fees/history')).body.data;
  assert.ok(h.transactions.length >= 7);
  assert.equal(h.semesters[0].status, 'paid');
  assert.equal(h.totals.paidPaise, TOTAL);
  const bHistory = (await b.get('/api/fees/history')).body.data;
  assert.equal(bHistory.transactions.length, 0, 'student B sees none of A\'s transactions');
});

test('editing a fee structure does not rewrite what students were already charged', async () => {
  const structure = await M.FeeStructure.findOne({ course: 'B.Tech' });
  const res = await hod.patch(`/api/admin/fees/structures/${structure._id}`, {
    components: [{ name: 'Tuition fee', kind: 'tuition', amountPaise: 99_999_900 }]
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.version, 2);
  assert.equal((await current(a)).totalPayablePaise, TOTAL);
  assert.equal((await current(b)).grossPaise, TOTAL);
  assert.equal((await hod.del(`/api/admin/fees/structures/${structure._id}`)).status, 409, 'assigned structures cannot be deleted');
});

test('financial records cannot be deleted', async () => {
  await assert.rejects(M.Payment.deleteOne({}), /cannot be deleted/);
  await assert.rejects(M.Payment.deleteMany({}), /cannot be deleted/);
  await assert.rejects(M.Receipt.deleteMany({}), /cannot be deleted/);
  await assert.rejects(M.FeeAssignment.deleteOne({}), /cannot be deleted/);
  await assert.rejects(M.AuditLog.deleteMany({}), /cannot be deleted/);
  await assert.rejects(M.AuditLog.updateMany({}, { $set: { action: 'x' } }), /immutable/);
});

test('administrators can search, filter, export and reconcile transactions but cannot force a success', async () => {
  const all = await hod.get('/api/admin/fees/transactions');
  assert.equal(all.status, 200);
  assert.ok(all.body.meta.total >= 7);
  const failed = await hod.get('/api/admin/fees/transactions?status=failed');
  assert.ok(failed.body.data.every(t => t.status === 'failed') && failed.body.data.length >= 1);
  const byRoll = await hod.get(`/api/admin/fees/transactions?q=${ctx.students[0].profile.rollNo.toLowerCase()}`);
  assert.ok(byRoll.body.data.length >= 7);
  const csv = await hod.get('/api/admin/fees/transactions?format=csv');
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Transaction ID,Date,Roll No/);

  // a created-but-unpaid order stays unpaid after reconcile: the gateway, not the admin, decides
  const id = (await current(b)).id;
  const o = await order(b, id, 100_000);
  const p = await M.Payment.findOne({ providerOrderId: o.body.data.checkout.orderId });
  const rec = await hod.post(`/api/admin/fees/transactions/${p._id}/reconcile`);
  assert.equal(rec.status, 200);
  assert.notEqual(rec.body.data.status, 'success');
  assert.equal((await hod.post(`/api/admin/fees/transactions/${p._id}`, { status: 'success' })).status, 404, 'there is no endpoint that sets a status by hand');

  const outstanding = await hod.get('/api/admin/fees/reports/outstanding?format=csv');
  assert.match(outstanding.text, /Outstanding \(INR\)/);
});

test('the payment simulator refuses to load in production', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e', "console.log(require('./src/config/env').config.payments.provider)"], {
    env: { ...process.env, NODE_ENV: 'production', PAYMENT_PROVIDER: 'simulator', SESSION_SECRET: 'x'.repeat(40) }, cwd: require('path').join(__dirname, '..', '..')
  }).toString().trim();
  assert.equal(out, 'none');
});
