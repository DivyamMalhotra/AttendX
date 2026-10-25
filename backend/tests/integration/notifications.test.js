const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, PASSWORD } = require('../helpers/fixtures');
const { installFakeProviders, removeFakeProviders, tokenFrom } = require('../helpers/fakes');

let ctx; let M; let box; let notifications; let delivery; let student; let studentUser;

const send = (over = {}) => notifications.notify({
  collegeId: ctx.college._id, userId: studentUser._id, type: 'attendance_shortage',
  title: 'Attendance shortage: Data Structures', message: 'Your attendance is 70% (28 of 40).', dedupeKey: `t:${Math.random()}`, ...over
});
const deliveries = filter => M.NotificationDelivery.find({ user: studentUser._id, ...filter }).sort({ createdAt: 1 });

before(async () => {
  const { models } = await harness.start();
  M = models;
  box = installFakeProviders();
  notifications = require('../../src/services/notificationService');
  delivery = require('../../src/services/deliveryService');
  ctx = await seedCollege(M, { code: 'NOTE1', students: 2 });
  studentUser = ctx.students[0].user;
  student = await harness.login(creds(ctx.college, studentUser));
});
after(async () => { removeFakeProviders(); await harness.stop(); });
beforeEach(async () => {
  box.emails.length = 0; box.sms.length = 0; box.failEmail = 0; box.failSms = 0;
  await M.NotificationDelivery.deleteMany({});
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.smsEnabled': false, 'settings.notifications': {} } });
  await M.User.updateOne({ _id: studentUser._id }, { $set: { phone: '', notificationPrefs: { email: true, sms: true } } });
});

test('the in-app notification is always kept, and an e-mail is queued, sent and recorded as sent (not delivered)', async () => {
  const n = await send();
  assert.ok(n);
  const [d] = await deliveries({ channel: 'email' });
  assert.equal(d.status, 'queued');
  const stats = await delivery.processQueue();
  assert.equal(stats.sent, 1);
  const sent = await M.NotificationDelivery.findById(d._id);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.providerMessageId, 'e1');
  assert.equal(box.emails.length, 1);
  assert.equal(box.emails[0].to, studentUser.email);
  assert.equal((await student.get('/api/student/notifications')).body.data.length, 1, 'the in-app record is still there');
});

test('subjects and SMS texts are generic: no names, marks or subject titles leak into previews', async () => {
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.smsEnabled': true } });
  await M.User.updateOne({ _id: studentUser._id }, { $set: { phone: '+919876543210' } });
  await send();
  await delivery.processQueue();
  const mail = box.emails[0];
  assert.equal(mail.subject, 'AttendX: Attendance alert');
  assert.ok(!/Data Structures|70%|Student 1/.test(mail.subject));
  assert.match(mail.text, /Data Structures/, 'details are in the body, for the recipient only');
  assert.equal(box.sms.length, 1);
  assert.ok(!/\d{2}%|Data Structures|Student/.test(box.sms[0].body));
  assert.ok(box.sms[0].body.length < 160);
});

test('user-supplied text is HTML-escaped in e-mail bodies', async () => {
  await send({ title: '<script>alert(1)</script>', message: 'x "quoted" <b>bold</b>', type: 'announcement' });
  await delivery.processQueue();
  assert.ok(!box.emails[0].html.includes('<script>'));
  assert.ok(box.emails[0].html.includes('&lt;script&gt;'));
});

test('duplicate events are not delivered twice', async () => {
  const key = 'same-event';
  assert.ok(await send({ dedupeKey: key }));
  assert.equal(await send({ dedupeKey: key }), null);
  await delivery.processQueue();
  await delivery.processQueue();
  assert.equal(box.emails.length, 1);
  assert.equal(await M.NotificationDelivery.countDocuments({ channel: 'email' }), 1);
});

test('SMS is only used when the college enables it, the event allows it and the user has a number', async () => {
  await send();                                   // sms not enabled
  assert.equal(await M.NotificationDelivery.countDocuments({ channel: 'sms' }), 0);

  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.smsEnabled': true } });
  await send();                                   // enabled but no number
  assert.equal((await deliveries({ channel: 'sms' }))[0].status, 'skipped');
  assert.match((await deliveries({ channel: 'sms' }))[0].reason, /no phone/);

  await M.User.updateOne({ _id: studentUser._id }, { $set: { phone: '+919876543210' } });
  await send({ type: 'announcement' });           // announcements are not SMS by default
  assert.equal(await M.NotificationDelivery.countDocuments({ channel: 'sms', notification: { $ne: null } }), 1);
  await send({ type: 'announcement', force: { sms: true } });  // urgent announcements may force SMS
  assert.equal(await M.NotificationDelivery.countDocuments({ channel: 'sms' }), 2);

  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.notifications': { assignment: { email: false, sms: true } } } });
  await send({ type: 'assignment' });              // administrator turned SMS on for assignments
  assert.equal(await M.NotificationDelivery.countDocuments({ channel: 'sms' }), 3);
});

test('non-mandatory notifications respect opt-outs; mandatory institutional ones do not', async () => {
  await M.User.updateOne({ _id: studentUser._id }, { $set: { notificationPrefs: { email: false, sms: false } } });
  await send({ type: 'announcement' });
  assert.equal(await M.NotificationDelivery.countDocuments({ channel: 'email' }), 0, 'opted out of announcements');
  await send({ type: 'attendance_shortage' });
  assert.equal(await M.NotificationDelivery.countDocuments({ channel: 'email' }), 1, 'attendance alerts are mandatory');
});

test('when no provider is configured deliveries are "skipped", never "sent"', async () => {
  removeFakeProviders();
  await send();
  const [d] = await deliveries({ channel: 'email' });
  assert.equal(d.status, 'skipped');
  assert.match(d.reason, /not configured/);
  box = installFakeProviders();
});

test('failed sends are retried with back-off and finally marked failed; the in-app record survives', async () => {
  box.failEmail = 99;
  await send();
  const now = new Date();
  let stats = await delivery.processQueue({ now });
  assert.equal(stats.retried, 1);
  let d = (await deliveries({ channel: 'email' }))[0];
  assert.equal(d.status, 'queued');
  assert.equal(d.attempts, 1);
  assert.ok(d.nextAttemptAt > now, 'back-off pushes the next attempt into the future');
  assert.match(d.lastError, /smtp down/);

  // not due yet -> nothing happens
  stats = await delivery.processQueue({ now });
  assert.deepEqual(stats, { sent: 0, retried: 0, failed: 0, skipped: 0 });

  let clock = now;
  for (let i = 0; i < 6; i += 1) { clock = new Date(clock.getTime() + 2 * 3600 * 1000); await delivery.processQueue({ now: clock }); }
  d = (await deliveries({ channel: 'email' }))[0];
  assert.equal(d.status, 'failed');
  assert.equal(d.attempts, 5);
  assert.equal(await M.Notification.countDocuments({ user: studentUser._id }) > 0, true);
});

test('a retry that succeeds ends as sent', async () => {
  box.failEmail = 1;
  await send();
  const now = new Date();
  await delivery.processQueue({ now });
  await delivery.processQueue({ now: new Date(now.getTime() + 3 * 3600 * 1000) });
  const d = (await deliveries({ channel: 'email' }))[0];
  assert.equal(d.status, 'sent');
  assert.equal(box.emails.length, 1);
});

test('concurrent workers never send the same delivery twice', async () => {
  for (let i = 0; i < 5; i += 1) await send();
  await Promise.all([delivery.processQueue(), delivery.processQueue(), delivery.processQueue()]);
  assert.equal(box.emails.length, 5);
});

test('delivered status only comes from a correctly signed provider callback', async () => {
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.smsEnabled': true } });
  await M.User.updateOne({ _id: studentUser._id }, { $set: { phone: '+919876543210' } });
  await send();
  await delivery.processQueue();
  const sms = (await deliveries({ channel: 'sms' }))[0];
  assert.equal(sms.status, 'sent');
  const bad = await harness.supertest().post('/api/notifications/sms-status').type('form').set('X-Twilio-Signature', 'forged').send({ MessageSid: sms.providerMessageId, MessageStatus: 'delivered' });
  assert.equal(bad.status, 403);
  assert.equal((await M.NotificationDelivery.findById(sms._id)).status, 'sent');
  const good = await harness.supertest().post('/api/notifications/sms-status').type('form').set('X-Twilio-Signature', 'valid-signature').send({ MessageSid: sms.providerMessageId, MessageStatus: 'delivered' });
  assert.equal(good.status, 204);
  const after = await M.NotificationDelivery.findById(sms._id);
  assert.equal(after.status, 'delivered');
  assert.ok(after.deliveredAt);
});

/* ------------------------------------------------------------ password reset */

const forgot = (over = {}) => harness.postPublic('/api/auth/forgot-password', { collegeCode: ctx.college.code, email: studentUser.email, ...over });

test('password reset: generic answer, hashed single-use token, new password works, old sessions end', async () => {
  const existing = await forgot();
  const unknown = await forgot({ email: 'nobody@example.edu' });
  const wrongCollege = await forgot({ collegeCode: 'NOPE' });
  assert.equal(existing.status, 202);
  assert.deepEqual(existing.body, unknown.body);
  assert.deepEqual(existing.body, wrongCollege.body);
  assert.equal(box.emails.length, 1, 'only the real account got an e-mail');

  const mail = box.emails[0];
  assert.equal(mail.to, studentUser.email);
  const token = tokenFrom(mail.text);
  assert.ok(token && token.length > 30);
  assert.match(mail.text, /\/reset-password\.html#token=/, 'token is in the URL fragment');

  const stored = await M.PasswordResetToken.findOne({ user: studentUser._id });
  assert.notEqual(stored.tokenHash, token);
  assert.equal(stored.tokenHash.length, 64);
  assert.equal(JSON.stringify(await M.NotificationDelivery.find({ purpose: 'password_reset' }).lean()).includes(token), false, 'the token is not stored with the delivery record');

  const oldSession = await harness.login(creds(ctx.college, studentUser));
  assert.equal((await oldSession.get('/api/auth/me')).status, 200);

  const weak = await harness.postPublic('/api/auth/reset-password', { token, newPassword: 'short' });
  assert.equal(weak.status, 400);
  const done = await harness.postPublic('/api/auth/reset-password', { token, newPassword: 'Brand3wPass' });
  assert.equal(done.status, 200);

  const reuse = await harness.postPublic('/api/auth/reset-password', { token, newPassword: 'Another1Pass' });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error.code, 'INVALID_RESET_TOKEN');

  assert.equal((await oldSession.get('/api/auth/me')).status, 401, 'existing sessions are invalidated');
  assert.equal((await harness.login({ collegeCode: ctx.college.code, email: studentUser.email, password: PASSWORD })).res.status, 401);
  assert.equal((await harness.login({ collegeCode: ctx.college.code, email: studentUser.email, password: 'Brand3wPass' })).res.status, 200);
  assert.ok(await M.AuditLog.exists({ action: 'auth.password_reset_completed' }));
});

test('password reset: expired, forged and superseded tokens are rejected', async () => {
  box.emails.length = 0;
  await forgot();
  const first = tokenFrom(box.emails[0].text);
  await forgot();
  const second = tokenFrom(box.emails[1].text);
  assert.notEqual(first, second);
  assert.equal((await harness.postPublic('/api/auth/reset-password', { token: first, newPassword: 'Valid1Passw' })).status, 400, 'a newer request kills the older link');

  await M.PasswordResetToken.collection.updateMany({ usedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await harness.postPublic('/api/auth/reset-password', { token: second, newPassword: 'Valid1Passw' })).status, 400, 'expired');
  assert.equal((await harness.postPublic('/api/auth/reset-password', { token: 'x'.repeat(43), newPassword: 'Valid1Passw' })).status, 400, 'forged');
});

test('password reset: requests are throttled per account and per IP', async () => {
  box.emails.length = 0;
  await M.PasswordResetToken.deleteMany({});
  for (let i = 0; i < 6; i += 1) await forgot();
  assert.equal(box.emails.length, 3, 'at most 3 reset mails per account per hour, answered identically');

  await harness.stop();
  await harness.start({ limiterOverrides: { passwordResetMax: 2 } });
  box = installFakeProviders();
  const c = await seedCollege(harness.models(), { code: 'RESET2' });
  let last;
  for (let i = 0; i < 4; i += 1) last = await harness.postPublic('/api/auth/forgot-password', { collegeCode: 'RESET2', email: c.hod.email });
  assert.equal(last.status, 429);
});

test('reset tokens never appear in application logs', async () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e', `
    process.env.LOG_LEVEL='info';process.env.NODE_ENV='development';process.env.SESSION_SECRET='x'.repeat(40);
    const l=require('./src/utils/logger');
    l.info('probe',{token:'SECRET-TOKEN-VALUE',password:'hunter2',nested:{password:'hunter2',signature:'abc'},cookie:'sid=1'});
  `], { cwd: require('path').join(__dirname, '..', '..') }).toString();
  assert.ok(!out.includes('SECRET-TOKEN-VALUE') && !out.includes('hunter2') && !out.includes('sid=1'));
  assert.match(out, /redacted/);
});
