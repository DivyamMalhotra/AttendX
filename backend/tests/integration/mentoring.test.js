const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff, PASSWORD } = require('../helpers/fixtures');
const { multipart, file } = require('../helpers/multipart');
const { todayISO, addDays } = require('../../src/utils/dates');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let t1; let t2; let s1; let s2; let counsellor; let registrar; let parent; let parentUser;
const today = todayISO('Asia/Kolkata');
const SECRET = 'Student mentioned family counselling trouble';
const id = x => String(x._id || x);

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'MNT1', students: 2 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
  counsellor = await makeStaff({ harness, hod, M, ctx, roleKey: 'counsellor', email: 'couns@mnt1.edu' });
  registrar = await makeStaff({ harness, hod, M, ctx, roleKey: 'registrar', email: 'reg@mnt1.edu' });
});
after(async () => { removeFakeProviders(); await harness.stop(); });

const stu = i => id(ctx.students[i].profile);

test('only admins with mentors.manage assign mentors; reassignment ends the old one and keeps history', async () => {
  assert.equal((await t1.post('/api/admin/mentoring/assign', { studentIds: [stu(0)], mentorId: id(ctx.teacher2) })).status, 403);
  const first = await hod.post('/api/admin/mentoring/assign', { studentIds: [stu(0)], mentorId: id(ctx.teacher) });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.assigned, 1);
  assert.equal((await hod.post('/api/admin/mentoring/assign', { studentIds: [stu(0)], mentorId: id(ctx.teacher) })).body.data.unchanged, 1);
  assert.equal((await hod.post('/api/admin/mentoring/assign', { studentIds: [stu(0)], mentorId: id(ctx.teacher2), reason: 'Faculty change' })).body.data.assigned, 1);
  const hist = (await hod.get(`/api/admin/mentoring/history/${stu(0)}`)).body.data;
  assert.equal(hist.length, 2);
  assert.equal(hist.filter(h => h.to === null).length, 1, 'exactly one active mentor');
  assert.equal(await M.MentorAssignment.countDocuments({ student: stu(0), to: null }), 1);
  assert.equal((await hod.post('/api/admin/mentoring/assign', { studentIds: [stu(1)], mentorId: id(ctx.students[0].user) })).body.error.code, 'MENTOR_NOT_FOUND', 'a student cannot be a mentor');
  assert.ok(await M.Notification.findOne({ user: ctx.students[0].user._id, title: 'Mentor assigned' }));
});

test('mentors reach only their own mentees', async () => {
  assert.deepEqual((await t2.get('/api/mentor/students')).body.data.map(s => s.rollNo || s.student?.rollNo), [ctx.students[0].profile.rollNo]);
  assert.equal((await t2.get(`/api/mentor/students/${stu(0)}/overview`)).status, 200);
  assert.equal((await t2.get(`/api/mentor/students/${stu(1)}/overview`)).status, 403);
  assert.equal((await t1.get(`/api/mentor/students/${stu(0)}/overview`)).status, 403, 'the previous mentor lost access');
  assert.equal((await s1.get(`/api/mentor/students/${stu(0)}/overview`)).status, 403, 'students are not mentors');
});

test('counselling notes: author-only by default; admins and wildcard roles cannot read them', async () => {
  const add = await t2.post(`/api/mentor/students/${stu(0)}/notes`, { content: SECRET, category: 'personal', followUpAction: 'Call guardian', followUpDate: addDays(today, 3) });
  assert.equal(add.status, 201);
  const noteId = add.body.data._id || add.body.data.id;

  assert.equal((await t1.post(`/api/mentor/students/${stu(0)}/notes`, { content: 'Not my student' })).status, 403);
  assert.equal((await t1.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403);
  assert.equal((await hod.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403, 'a college wildcard does not include counselling notes');
  assert.equal((await registrar.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403);
  assert.equal((await s1.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403);

  assert.equal((await t2.get(`/api/mentor/students/${stu(0)}/notes`)).body.data.length, 1);
  assert.equal((await t2.get('/api/mentor/followups')).body.data[0].action, 'Call guardian');

  const read = await counsellor.get(`/api/mentor/students/${stu(0)}/notes`);
  assert.equal(read.status, 200, 'the counsellor role holds mentorNotes.view explicitly');
  assert.equal(read.body.data[0].content, SECRET);
  assert.ok(await M.AuditLog.findOne({ action: 'mentornote.accessed' }), 'reading someone else\'s notes is audited');

  assert.equal((await counsellor.patch(`/api/mentor/notes/${noteId}`, { content: 'Edited by someone else' })).status, 403, 'only the author edits');
  assert.equal((await t2.patch(`/api/mentor/notes/${noteId}`, { followUpDone: true })).status, 200);
  assert.equal((await t2.get('/api/mentor/followups')).body.data.length, 0);
});

test('the mentor overview and every timeline omit counselling notes and medical leave', async () => {
  await M.DutyLeaveRequest.deleteMany({});
  const types = (await hod.get('/api/admin/leave-types')).body.data;
  const med = types.find(t => t.key === 'medical');
  const duty = types.find(t => t.key === 'duty');
  const r1 = await multipart(s1, 'post', '/api/student/duty-leaves', { reason: 'Hospital admission', fromDate: addDays(today, -2), toDate: addDays(today, -2), leaveTypeId: String(med._id) }, [{ ...file(), field: 'document' }]);
  assert.equal(r1.status, 201);
  assert.equal((await multipart(s1, 'post', '/api/student/duty-leaves', { reason: 'Fest', fromDate: addDays(today, -1), toDate: addDays(today, -1), leaveTypeId: String(duty._id) })).status, 201);

  const self = (await s1.get('/api/student/timeline')).body.data;
  assert.ok(self.events.some(e => /Medical leave requested/.test(e.title)), 'the student sees their own medical request');

  const viaMentor = JSON.stringify((await t2.get(`/api/mentor/students/${stu(0)}/timeline`)).body.data);
  const overview = JSON.stringify((await t2.get(`/api/mentor/students/${stu(0)}/overview`)).body.data);
  for (const blob of [viaMentor, overview, JSON.stringify(self)]) {
    assert.ok(!blob.includes(SECRET), 'counselling note text never appears');
    assert.ok(!blob.includes('Hospital'), 'leave reasons never appear');
  }
  assert.ok(!/Medical leave/.test(viaMentor), 'medical leave is not on the staff timeline');
  assert.ok(/Duty leave requested/.test(viaMentor));

  assert.equal((await t1.get(`/api/mentor/students/${stu(0)}/timeline`)).status, 403);
  const adminView = await registrar.get(`/api/admin/mentoring/students/${stu(0)}/timeline`);
  assert.equal(adminView.status, 403, 'timeline.view is needed for the institutional route');
  assert.equal((await counsellor.get(`/api/admin/mentoring/students/${stu(0)}/timeline`)).status, 200);
});

test('the timeline is derived, filterable and paginated', async () => {
  const all = (await s1.get('/api/student/timeline?limit=2')).body.data;
  assert.equal(all.events.length, 2);
  assert.ok(all.nextBefore);
  const next = (await s1.get(`/api/student/timeline?limit=50&before=${encodeURIComponent(all.nextBefore)}`)).body.data;
  assert.ok(next.events.every(e => new Date(e.at) < new Date(all.nextBefore)));
  const onlyLeave = (await s1.get('/api/student/timeline?categories=leave')).body.data;
  assert.ok(onlyLeave.events.length && onlyLeave.events.every(e => e.category === 'leave'));
  const ids = [...all.events, ...next.events].map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'no event is repeated across pages');
  assert.equal(await M.Notification.countDocuments({ title: /timeline/i }), 0, 'nothing is stored for the timeline itself');
});

test('parent accounts need a recorded verification and are linked to specific students only', async () => {
  const body = { name: 'Parent One', email: 'parent@mnt1.edu', password: PASSWORD, studentId: stu(0), relationship: 'mother' };
  assert.equal((await hod.post('/api/admin/mentoring/parents', body)).status, 400, 'a verification note is mandatory');
  assert.equal((await t1.post('/api/admin/mentoring/parents', { ...body, verificationNote: 'ID checked at office' })).status, 403);
  const created = await hod.post('/api/admin/mentoring/parents', { ...body, verificationNote: 'ID checked at office' });
  assert.equal(created.status, 201);
  parentUser = await M.User.findOne({ email: 'parent@mnt1.edu' });
  assert.equal(parentUser.role, 'parent');
  assert.equal(parentUser.mustChangePassword, true);
  assert.equal((await hod.post('/api/admin/mentoring/parents', { ...body, verificationNote: 'ID checked again' })).status, 409, 'duplicate email');
  assert.ok(await M.AuditLog.findOne({ action: 'parent.linked' }));
  await M.User.updateOne({ _id: parentUser._id }, { $set: { mustChangePassword: false } });
  parent = await harness.login({ collegeCode: 'MNT1', email: 'parent@mnt1.edu', password: PASSWORD });
});

test('parents are read-only, see only linked children, and only what the college shares', async () => {
  const kids = (await parent.get('/api/parent/children')).body.data;
  assert.equal(kids.length, 1);
  assert.equal(kids[0].rollNo, ctx.students[0].profile.rollNo);

  assert.equal((await parent.get(`/api/parent/children/${stu(1)}/summary`)).status, 404, 'another family\'s child is invisible');
  assert.equal((await parent.get(`/api/parent/children/${stu(1)}/timeline`)).status, 404);
  const sum = (await parent.get(`/api/parent/children/${stu(0)}/summary`)).body.data;
  assert.ok(sum.attendance && sum.leave && sum.fees);
  assert.ok(!JSON.stringify(sum).includes('Hospital') && !JSON.stringify(sum).includes(SECRET));
  assert.ok(await M.AuditLog.findOne({ action: 'parent.viewed', actor: parentUser._id }), 'parent views are audited');

  for (const [method, url] of [['post', '/api/student/duty-leaves'], ['get', '/api/student/attendance'], ['get', '/api/admin/leave-types'], ['get', '/api/faculty/subjects'], ['get', `/api/mentor/students/${stu(0)}/notes`]]) {
    const res = await parent[method](url, method === 'post' ? {} : undefined);
    assert.ok([401, 403].includes(res.status), `${method} ${url} must be refused for a parent (got ${res.status})`);
  }
  assert.ok([404, 405].includes((await parent.post(`/api/parent/children/${stu(0)}/summary`, {})).status));

  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.parentVisibility.fees': false, 'settings.parentVisibility.leave': false } });
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/fees`)).body.error.code, 'NOT_SHARED');
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/leave`)).status, 403);
  const hidden = (await parent.get(`/api/parent/children/${stu(0)}/summary`)).body.data;
  assert.ok(!hidden.fees && !hidden.leave && hidden.attendance);
  const tl = (await parent.get(`/api/parent/children/${stu(0)}/timeline`)).body.data;
  assert.ok(tl.events.every(e => !['fees', 'leave'].includes(e.category)), 'timeline honours the same visibility switches');
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.parentVisibility.fees': true, 'settings.parentVisibility.leave': true } });
});

test('revoking a link removes access immediately', async () => {
  const link = await M.ParentLink.findOne({ parent: parentUser._id });
  assert.equal((await t1.post(`/api/admin/mentoring/parents/links/${link._id}/revoke`, {})).status, 403);
  assert.equal((await hod.post(`/api/admin/mentoring/parents/links/${link._id}/revoke`, { reason: 'Custody change' })).status, 200);
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/summary`)).status, 404);
  assert.deepEqual((await parent.get('/api/parent/children')).body.data, []);
  assert.equal((await hod.post(`/api/admin/mentoring/parents/links/${link._id}/revoke`, {})).status, 404, 'cannot revoke twice');
  assert.ok(await M.AuditLog.findOne({ action: 'parent.revoked' }));
  assert.equal((await hod.post('/api/admin/mentoring/parents/links', { parentId: id(parentUser), studentId: stu(1), verificationNote: 'Verified sibling' })).status, 201, 'a new, verified link can be made later');
  assert.equal((await parent.get(`/api/parent/children/${stu(1)}/summary`)).status, 200);
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/summary`)).status, 404);
});
