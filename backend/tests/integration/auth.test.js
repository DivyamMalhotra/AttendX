const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, PASSWORD } = require('../helpers/fixtures');

let ctx;
before(async () => {
  const { models } = await harness.start();
  ctx = await seedCollege(models, { code: 'AUTH1' });
});
after(() => harness.stop());

test('protected endpoints reject unauthenticated requests', async () => {
  for (const url of ['/api/auth/me', '/api/admin/sections', '/api/faculty/subjects', '/api/student/dashboard', '/api/fees/summary']) {
    const res = await harness.supertest().get(url);
    assert.equal(res.status, 401, url);
  }
});

test('invalid credentials are rejected with a generic message', async () => {
  const bad = await harness.login({ collegeCode: 'AUTH1', email: ctx.hod.email, password: 'wrong-password1' });
  assert.equal(bad.res.status, 401);
  assert.equal(bad.res.body.error.code, 'INVALID_CREDENTIALS');
  const unknown = await harness.login({ collegeCode: 'AUTH1', email: 'nobody@x.edu', password: PASSWORD });
  assert.equal(unknown.res.status, 401);
  assert.equal(unknown.res.body.error.message, bad.res.body.error.message);
  const wrongCollege = await harness.login({ collegeCode: 'NOPE', email: ctx.hod.email, password: PASSWORD });
  assert.equal(wrongCollege.res.status, 401);
});

test('login sets a secure session cookie, never returns the hash, and logout invalidates the session', async () => {
  const s = await harness.login(creds(ctx.college, ctx.hod));
  assert.equal(s.res.status, 200);
  const cookie = s.res.headers['set-cookie'].find(c => c.startsWith('attendx.sid='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.ok(!JSON.stringify(s.res.body).includes('passwordHash'));
  assert.equal((await s.get('/api/auth/me')).status, 200);

  assert.equal((await s.post('/api/auth/logout')).status, 200);
  assert.equal((await s.get('/api/auth/me')).status, 401);
});

test('session id is regenerated on login (no fixation)', async () => {
  const agent = require('supertest').agent(harness.getApp());
  const pre = await agent.get('/api/auth/csrf');
  const before = pre.headers['set-cookie'].find(c => c.startsWith('attendx.sid='));
  const res = await agent.post('/api/auth/login').set('X-CSRF-Token', pre.body.data.csrfToken).send(creds(ctx.college, ctx.hod));
  const after = res.headers['set-cookie'].find(c => c.startsWith('attendx.sid='));
  assert.notEqual(before.split(';')[0], after.split(';')[0]);
});

test('state-changing requests without a CSRF token are rejected', async () => {
  const s = await harness.login(creds(ctx.college, ctx.hod));
  const res = await s.raw.post('/api/admin/sections').send({ name: 'X', semesterNumber: 1 });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'CSRF_INVALID');
  const bad = await s.raw.post('/api/admin/sections').set('X-CSRF-Token', 'nope').send({ name: 'X', semesterNumber: 1 });
  assert.equal(bad.status, 403);
});

test('role-based authorization is enforced on the server', async () => {
  const student = await harness.login(creds(ctx.college, ctx.students[0].user));
  const teacher = await harness.login(creds(ctx.college, ctx.teacher));
  assert.equal((await student.get('/api/admin/sections')).status, 403);
  assert.equal((await student.get('/api/faculty/subjects')).status, 403);
  assert.equal((await teacher.get('/api/admin/sections')).status, 403);
  assert.equal((await teacher.get('/api/student/dashboard')).status, 403);
  assert.equal((await teacher.get('/api/fees/summary')).status, 403);
  assert.equal((await student.post('/api/admin/students', {})).status, 403);
});

test('users from another college cannot sign in with this college code', async () => {
  const other = await seedCollege(harness.models(), { code: 'AUTH2' });
  const res = await harness.login({ collegeCode: 'AUTH1', email: other.hod.email, password: PASSWORD });
  assert.equal(res.res.status, 401);
});

test('repeated failures lock the account temporarily', async () => {
  const victim = ctx.students[1].user;
  for (let i = 0; i < 5; i += 1) await harness.login({ collegeCode: 'AUTH1', email: victim.email, password: 'bad-password1' });
  const res = await harness.login(creds(ctx.college, victim));
  assert.equal(res.res.status, 423);
  await harness.models().User.updateOne({ _id: victim._id }, { $set: { lockedUntil: null, failedLogins: 0 } });
});

test('a user flagged mustChangePassword can only change the password; changing it ends other sessions', async () => {
  const { User } = harness.models();
  const target = ctx.students[2].user;
  await User.updateOne({ _id: target._id }, { $set: { mustChangePassword: true } });

  const first = await harness.login(creds(ctx.college, target));
  const second = await harness.login(creds(ctx.college, target));
  const blocked = await first.get('/api/student/dashboard');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  const weak = await first.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' });
  assert.equal(weak.status, 400);
  const ok = await first.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'N3wPassword' });
  assert.equal(ok.status, 200);

  assert.equal((await first.get('/api/student/dashboard')).status, 200);
  assert.equal((await second.get('/api/auth/me')).status, 401, 'other sessions must be invalidated');
  const relogin = await harness.login({ collegeCode: 'AUTH1', email: target.email, password: 'N3wPassword' });
  assert.equal(relogin.res.status, 200);
});

test('password hashes are bcrypt and never stored in plaintext', async () => {
  const u = await harness.models().User.findById(ctx.hod._id).select('+passwordHash');
  assert.match(u.passwordHash, /^\$2[aby]\$/);
  assert.notEqual(u.passwordHash, PASSWORD);
});

test('login endpoint is rate limited', async () => {
  await harness.stop();
  await harness.start({ limiterOverrides: { loginMax: 3 } });
  const c = await seedCollege(harness.models(), { code: 'RATE1' });
  let last;
  for (let i = 0; i < 5; i += 1) last = await harness.login({ collegeCode: 'RATE1', email: c.hod.email, password: 'wrong-pass1' });
  assert.equal(last.res.status, 429);
  assert.equal(last.res.body.error.code, 'LOGIN_RATE_LIMITED');
});
