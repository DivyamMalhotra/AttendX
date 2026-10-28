const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, PASSWORD } = require('../helpers/fixtures');
const { multipart, file } = require('../helpers/multipart');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let t1; let t2; let s1; let s2; let sOther; let box; let sec2; let registrar; let delivery;
const hours = h => new Date(Date.now() + h * 3600000).toISOString();

const post = (agent, fields, files = []) => multipart(agent, 'post', '/api/announcements', { title: 'Holiday notice', body: 'College closed on Monday.', audience: { all: true }, ...fields }, files);
const feed = async agent => (await agent.get('/api/announcements')).body.data;
const mine = async (agent, title) => (await feed(agent)).find(a => a.title === title);
const notes = (user, title) => M.Notification.countDocuments({ user: user._id, type: 'announcement', title });

before(async () => {
  const { models } = await harness.start();
  M = models;
  box = installFakeProviders();
  delivery = require('../../src/services/deliveryService');
  ctx = await seedCollege(M, { code: 'ANN1', students: 2 });
  await require('../../src/services/accessService').ensureBuiltInRoles(ctx.college._id);
  sec2 = await M.Section.create({ college: ctx.college._id, name: 'EC-A', nameKey: 'ec-a', sem: 'Sem 5', semesterNumber: 5, course: 'B.Tech' });
  const stu = await require('../../src/services/studentService').registerStudent(ctx.hod, ctx.college._id, { name: 'Far Student', email: 'far@ann1.edu', password: PASSWORD, rollNo: 'ANN1500', sectionId: sec2._id });
  await M.User.updateMany({ college: ctx.college._id }, { $set: { mustChangePassword: false } });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
  sOther = await harness.login({ collegeCode: ctx.college.code, email: stu.user.email, password: PASSWORD });
  registrar = await require('../helpers/fixtures').makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'reg@ann1.edu' });   // a non-publishing staff role
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('only authorised publishers can publish; an audience is mandatory', async () => {
  assert.equal((await post(t1, {})).status, 403);
  assert.equal((await post(s1, {})).status, 403);
  assert.equal((await post(hod, { audience: {} })).body.error.code, 'EMPTY_AUDIENCE');
  assert.equal((await post(hod, { audience: { sections: ['64b7f0f0f0f0f0f0f0f0f0f0'] } })).body.error.code, 'SECTION_NOT_FOUND');
  assert.equal((await post(hod, { audience: 'not json' })).status, 400);
  assert.equal((await post(hod, { expiresAt: hours(1), publishAt: hours(5) })).body.error.code, 'INVALID_EXPIRY');
  assert.equal((await post(hod, { title: 'Draft only' })).status, 201);
  assert.equal((await post(registrar, { title: 'By accounts clerk' })).status, 403, 'only the Administrator publishes announcements');
});

test('drafts are invisible; publishing delivers to the audience; users never see announcements meant for others', async () => {
  const draft = (await post(hod, { title: 'Section notice', audience: { sections: [String(ctx.section._id)] } })).body.data;
  assert.equal(await mine(s1, 'Section notice'), undefined, 'drafts are private');
  assert.equal((await t1.post(`/api/announcements/${draft._id}/publish`)).status, 403);
  assert.equal((await hod.post(`/api/announcements/${draft._id}/publish`)).body.data.status, 'published');

  assert.ok(await mine(s1, 'Section notice'));
  assert.ok(await mine(s2, 'Section notice'));
  assert.equal(await mine(sOther, 'Section notice'), undefined, 'a student of another section never sees it');
  assert.ok(await mine(t1, 'Section notice'), 'teachers of that section do');
  assert.equal(await notes(ctx.students[0].user, 'Section notice'), 1);
  assert.equal(await notes(sOther.user ? { _id: sOther.user.id } : {}, 'Section notice'), 0);

  // role + semester + course targeting
  await hod.post(`/api/announcements/${(await post(hod, { title: 'Sem 5 only', audience: { semesters: [5] } })).body.data._id}/publish`);
  assert.ok(await mine(sOther, 'Sem 5 only'));
  assert.equal(await mine(s1, 'Sem 5 only'), undefined);
  await hod.post(`/api/announcements/${(await post(hod, { title: 'Faculty only', audience: { roles: ['teacher'] } })).body.data._id}/publish`);
  assert.ok(await mine(t2, 'Faculty only'));
  assert.equal(await mine(s1, 'Faculty only'), undefined);
  await hod.post(`/api/announcements/${(await post(hod, { title: 'B.Tech students', audience: { roles: ['student'], courses: ['B.Tech'] } })).body.data._id}/publish`);
  assert.ok(await mine(s1, 'B.Tech students'));
  assert.equal(await mine(t1, 'B.Tech students'), undefined);
  assert.equal(await mine(registrar, 'Section notice'), undefined, 'staff are not addressed by a class announcement');
});

test('editing or republishing never notifies twice; withdrawn and expired announcements disappear', async () => {
  const a = (await post(hod, { title: 'Exam rules', body: 'Bring ID.', priority: 'high' })).body.data;
  await hod.post(`/api/announcements/${a._id}/publish`);
  assert.equal(await notes(ctx.students[0].user, 'Exam rules'), 1);

  const edit = await hod.patch(`/api/announcements/${a._id}`, { body: 'Bring ID and hall ticket.' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.data.revision, 2);
  assert.equal((await mine(s1, 'Exam rules')).edited, true);
  assert.equal(await notes(ctx.students[0].user, 'Exam rules'), 1, 'an edit does not re-notify');

  assert.equal((await hod.post(`/api/announcements/${a._id}/withdraw`)).body.data.status, 'withdrawn');
  assert.equal(await mine(s1, 'Exam rules'), undefined);
  assert.equal((await hod.patch(`/api/announcements/${a._id}`, { title: 'x2' })).body.error.code, 'WITHDRAWN');
  assert.equal((await hod.post(`/api/announcements/${a._id}/publish`)).body.data.status, 'published');
  assert.ok(await mine(s1, 'Exam rules'));
  assert.equal(await notes(ctx.students[0].user, 'Exam rules'), 1, 'republishing does not re-notify');

  await M.Announcement.updateOne({ _id: a._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await mine(s1, 'Exam rules'), undefined, 'expired');
  const list = (await hod.get('/api/announcements/manage')).body.data.find(x => x._id === a._id);
  assert.equal(list.expired, true);

  const future = (await post(hod, { title: 'Next week', publishAt: hours(48), publishNow: 'true' })).body.data;
  assert.equal(await mine(s1, 'Next week'), undefined, 'not yet started');
  assert.ok(future);
});

test('read tracking is one row per user, only for announcements you can see, with engagement stats for publishers', async () => {
  const a = (await post(hod, { title: 'Read me', audience: { sections: [String(ctx.section._id)] }, publishNow: 'true' })).body.data;
  assert.equal((await s1.post(`/api/announcements/${a._id}/read`)).status, 200);
  await s1.post(`/api/announcements/${a._id}/read`);
  assert.equal(await M.AnnouncementRead.countDocuments({ announcement: a._id }), 1, 'repeats are harmless');
  assert.equal((await mine(s1, 'Read me')).read, true);
  assert.equal((await mine(s2, 'Read me')).read, false);
  assert.equal((await sOther.post(`/api/announcements/${a._id}/read`)).status, 404, 'cannot touch announcements meant for others');

  const stats = (await hod.get(`/api/announcements/${a._id}/stats`)).body.data;
  assert.equal(stats.read, 1);
  assert.ok(stats.recipients >= 3);
  assert.ok(stats.unreadNames.some(n => n.name === 'Student 2'));
  assert.equal((await s1.get(`/api/announcements/${a._id}/stats`)).status, 403);
  assert.equal((await t1.get(`/api/announcements/${a._id}/stats`)).status, 403);
  const unread = (await s1.get('/api/announcements?unread=true')).body.data;
  assert.equal(unread.some(x => x.title === 'Read me'), false);
});

test('attachments are validated and only served to the audience (or managers); drafts only to managers', async () => {
  assert.equal((await post(hod, { title: 'Bad file' }, [file('x.exe', Buffer.from('MZ'), 'application/x-msdownload')])).body.error.code, 'UNSUPPORTED_FILE_TYPE');
  const a = (await post(hod, { title: 'Circular', audience: { sections: [String(ctx.section._id)] } }, [file('circular.pdf')])).body.data;
  const url = `/api/files/announcement/${a._id}/0`;
  assert.equal((await s1.get(url)).status, 403, 'draft');
  assert.equal((await hod.get(url)).status, 200, 'author');
  await hod.post(`/api/announcements/${a._id}/publish`);
  assert.equal((await s1.get(url)).status, 200);
  assert.equal((await sOther.get(url)).status, 403, 'not addressed to them');
  assert.equal((await registrar.get(url)).status, 403, 'staff without announcement rights may not');
  assert.equal((await harness.supertest().get(url)).status, 401);
  assert.equal((await harness.supertest().get(`/uploads/announcements/${(await M.Announcement.findById(a._id)).attachments[0].storedName}`)).status, 404, 'not publicly guessable');
});

test('notifications: e-mail with generic subject; urgent announcements may also use SMS when the college enables it', async () => {
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.smsEnabled': true } });
  await M.User.updateOne({ _id: ctx.students[0].user._id }, { $set: { phone: '+919876543210' } });
  box.emails.length = 0; box.sms.length = 0;
  const a = (await post(hod, { title: 'Campus closed <b>today</b>', body: 'Heavy rain. <script>x</script>', priority: 'urgent', audience: { sections: [String(ctx.section._id)] }, publishNow: 'true' })).body.data;
  await delivery.processQueue();
  const mail = box.emails.find(e => e.to === ctx.students[0].user.email && /Campus closed/.test(e.text));
  assert.ok(mail);
  assert.equal(mail.subject, 'AttendX: New announcement');
  assert.ok(!mail.html.includes('<script>x'), 'escaped');
  assert.equal(box.sms.length, 1, 'only the student with a phone number gets the SMS');
  assert.ok(!/rain|Campus/i.test(box.sms[0].body), 'SMS carries no content');
  assert.ok(a);
});

