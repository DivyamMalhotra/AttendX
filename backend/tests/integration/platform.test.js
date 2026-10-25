const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');

let ctx; let M; let hod; let studentA; let studentB; let server; let port; let runner; let live;

/** Opens an SSE stream with a session cookie and collects parsed events. */
function openStream(cookie, headers = {}) {
  const events = [];
  let buffer = '';
  const req = http.get({ port, path: '/api/events', headers: { Cookie: cookie, ...headers } });
  const ready = new Promise((resolve, reject) => {
    req.on('response', res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
          const evt = {};
          block.split('\n').forEach(l => { const m = /^(\w+): ?(.*)$/.exec(l); if (m) evt[m[1]] = m[2]; });
          if (evt.event) events.push({ id: Number(evt.id), type: evt.event, data: JSON.parse(evt.data) });
        }
      });
      resolve(res);
    });
    req.on('error', reject);
  });
  return { events, ready, close: () => req.destroy() };
}
const cookieOf = s => s.res.headers['set-cookie'].find(c => c.startsWith('attendx.sid=')).split(';')[0];
const waitFor = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };

before(async () => {
  const { models, app } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'PLAT1', students: 2 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  studentA = await harness.login(creds(ctx.college, ctx.students[0].user));
  studentB = await harness.login(creds(ctx.college, ctx.students[1].user));
  runner = require('../../src/jobs/runner');
  require('../../src/jobs');
  live = require('../../src/services/liveService');
  server = app.listen(0);
  port = server.address().port;
});
after(async () => { server.closeAllConnections(); server.close(); await harness.stop(); });

test('every response carries a request id; valid incoming ids are reused, hostile ones replaced', async () => {
  const a = await harness.supertest().get('/health');
  assert.match(a.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  const b = await harness.supertest().get('/health').set('X-Request-Id', 'trace-abc-123456');
  assert.equal(b.headers['x-request-id'], 'trace-abc-123456');
  const c = await harness.supertest().get('/health').set('X-Request-Id', 'bad id <script>');
  assert.notEqual(c.headers['x-request-id'], 'bad id <script>');
  assert.match(c.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

test('error responses include the request id for troubleshooting', async () => {
  const res = await harness.supertest().get('/api/admin/sections').set('X-Request-Id', 'support-ticket-001');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.requestId, 'support-ticket-001');
  const missing = await harness.supertest().get('/api/nope');
  assert.equal(missing.status, 404);
  assert.ok(missing.body.error.requestId);
});

test('/health is public and minimal; /ready is restricted and never leaks internals', async () => {
  const health = await harness.supertest().get('/health');
  assert.deepEqual(health.body, { status: 'ok' });
  assert.equal((await harness.supertest().get('/ready')).status, 401);
  assert.equal((await harness.supertest().get('/ready').set('X-Health-Token', 'wrong')).status, 401);

  const teacher = await harness.login(creds(ctx.college, ctx.teacher));
  assert.equal((await teacher.get('/ready')).status, 403);

  const viaSession = await hod.get('/ready');
  assert.equal(viaSession.status, 200);
  assert.equal(viaSession.body.checks.database.ok, true);
  const text = JSON.stringify(viaSession.body);
  assert.ok(!/mongodb:\/\/|SESSION_SECRET|127\.0\.0\.1|stack|password/i.test(text), 'no connection strings, env values or stacks');
});

test('jobs run under a lock, are recorded, and failures are visible rather than swallowed', async () => {
  runner.defineJob({ name: 'probe-ok', run: async () => ({ done: 1 }) });
  runner.defineJob({ name: 'probe-fail', run: async () => { throw new Error('boom'); } });
  const ok = await runner.runJob('probe-ok');
  assert.deepEqual(ok, { status: 'ok', stats: { done: 1 } });
  const bad = await runner.runJob('probe-fail');
  assert.equal(bad.status, 'failed');
  const rows = await M.JobRun.find({ name: { $in: ['probe-ok', 'probe-fail'] } }).lean();
  assert.equal(rows.find(r => r.name === 'probe-fail').error, 'boom');
  assert.equal(rows.find(r => r.name === 'probe-ok').status, 'ok');

  const ready = await hod.get('/ready');
  assert.equal(ready.body.status, 'degraded');
  assert.ok(ready.body.checks.jobs.failed.includes('probe-fail'));
});

test('a job already running on another instance is skipped, not run twice', async () => {
  runner.defineJob({ name: 'probe-slow', lockMinutes: 5, run: async () => ({ slow: true }) });
  await M.JobLock.create({ _id: 'probe-slow', owner: 'another-server', lockedUntil: new Date(Date.now() + 60000) });
  assert.equal((await runner.runJob('probe-slow')).status, 'skipped');
  await M.JobLock.updateOne({ _id: 'probe-slow' }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  assert.equal((await runner.runJob('probe-slow')).status, 'ok', 'an expired lock is taken over');
});

test('administrators with system.jobs can list and run jobs; others cannot', async () => {
  const list = await hod.get('/api/admin/system/jobs');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some(j => j.name === 'notification-queue'));
  const run = await hod.post('/api/admin/system/jobs/notification-queue/run');
  assert.equal(run.status, 200);
  assert.equal(run.body.data.status, 'ok');
  assert.equal((await hod.post('/api/admin/system/jobs/nope/run')).status, 404);
  assert.equal((await studentA.post('/api/admin/system/jobs/notification-queue/run')).status, 403);
});

test('SSE: requires authentication', async () => {
  const res = await new Promise(resolve => http.get({ port, path: '/api/events' }, resolve));
  assert.equal(res.statusCode, 401);
  res.resume();
});

test('SSE: a user receives only their own events, with ids and content-free payloads', async () => {
  const a = openStream(cookieOf(studentA));
  const b = openStream(cookieOf(studentB));
  await Promise.all([a.ready, b.ready]);
  await new Promise(r => setTimeout(r, 100));

  const notifications = require('../../src/services/notificationService');
  await notifications.notify({ collegeId: ctx.college._id, userId: ctx.students[0].user._id, type: 'payment', title: 'Secret title 5000', message: 'Secret message', dedupeKey: 'sse-1' });
  assert.ok(await waitFor(() => a.events.length >= 1));
  assert.equal(a.events[0].type, 'notification');
  assert.ok(a.events[0].id > 0);
  assert.ok(!JSON.stringify(a.events).includes('Secret'), 'no message text travels over SSE');
  await new Promise(r => setTimeout(r, 150));
  assert.equal(b.events.length, 0, 'another user never receives it');
  a.close(); b.close();
});

test('SSE: reconnecting with Last-Event-ID replays only what was missed', async () => {
  const uid = ctx.students[0].user._id;
  const first = await live.publish(uid, 'payment.updated', { paymentId: 'p1' });
  const second = await live.publish(uid, 'payment.updated', { paymentId: 'p2' });
  const s = openStream(cookieOf(studentA), { 'Last-Event-ID': String(first.seq) });
  await s.ready;
  assert.ok(await waitFor(() => s.events.some(e => e.id === second.seq)));
  assert.ok(!s.events.some(e => e.id === first.seq), 'already-seen events are not repeated');
  assert.equal(s.events.find(e => e.id === second.seq).data.paymentId, 'p2');
  s.close();
});

test('SSE: a live event cannot mark a payment paid; settlement publishes ids only', async () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'services', 'paymentSettlement.js'), 'utf8');
  assert.match(src, /live\.publish\(profile\.user, 'payment\.updated', \{ paymentId/);
  const before = await M.Payment.countDocuments({ status: 'success' });
  await live.publish(ctx.students[0].user._id, 'payment.updated', { paymentId: 'forged', status: 'success' });
  assert.equal(await M.Payment.countDocuments({ status: 'success' }), before);
});

test('SSE: a signed-out session is no longer served', async () => {
  const agent = await harness.login(creds(ctx.college, ctx.students[1].user));
  const cookie = cookieOf(agent);
  await agent.post('/api/auth/logout');
  const res = await new Promise(resolve => http.get({ port, path: '/api/events', headers: { Cookie: cookie } }, resolve));
  assert.equal(res.statusCode, 401);
  res.resume();
});
