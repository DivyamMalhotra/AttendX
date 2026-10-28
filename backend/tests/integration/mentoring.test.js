const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { multipart, file } = require('../helpers/multipart');
const { todayISO, addDays } = require('../../src/utils/dates');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let t1; let t2; let s1; let s2; let librarian;
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
  librarian = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'lib@mnt1.edu' });
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

test('counselling notes: only the author reads them; no role (not even the Administrator) can', async () => {
  const add = await t2.post(`/api/mentor/students/${stu(0)}/notes`, { content: SECRET, category: 'personal', followUpAction: 'Call guardian', followUpDate: addDays(today, 3) });
  assert.equal(add.status, 201);
  const noteId = add.body.data._id || add.body.data.id;

  assert.equal((await t1.post(`/api/mentor/students/${stu(0)}/notes`, { content: 'Not my student' })).status, 403);
  assert.equal((await t1.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403);
  assert.equal((await hod.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403, 'a college wildcard does not include counselling notes');
  assert.equal((await librarian.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403);
  assert.equal((await s1.get(`/api/mentor/students/${stu(0)}/notes`)).status, 403);

  assert.equal((await t2.get(`/api/mentor/students/${stu(0)}/notes`)).body.data.length, 1);
  assert.equal((await t2.get('/api/mentor/followups')).body.data[0].action, 'Call guardian');

  assert.equal((await t1.patch(`/api/mentor/notes/${noteId}`, { content: 'Edited by someone else' })).status, 403, 'only the author edits');
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
  const adminView = await librarian.get(`/api/admin/mentoring/students/${stu(0)}/timeline`);
  assert.equal(adminView.status, 403, 'timeline.view is needed for the institutional route');
  const viaAdmin = await hod.get(`/api/admin/mentoring/students/${stu(0)}/timeline`);
  assert.equal(viaAdmin.status, 200);
  assert.ok(!JSON.stringify(viaAdmin.body.data).includes(SECRET), 'the Administrator timeline never carries counselling notes');
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



test('attendance watch: a teacher sees alerts and at-risk students for their own mentees only, without fee data', async () => {
  const sub = ctx.subjects.ds;
  const sess = await M.ClassSession.create({ college: ctx.college._id, subject: sub._id, section: ctx.section._id, teacher: ctx.teacher2._id, date: addDays(today, -1), slot: '9:00 AM – 10:00 AM', status: 'submitted' });
  for (const [i, status] of [[0, 'A'], [1, 'P']]) {
    await M.Attendance.create({ college: ctx.college._id, classSession: sess._id, student: ctx.students[i].profile._id, subject: sub._id, section: ctx.section._id, date: addDays(today, -1), status });
  }
  await M.AttendanceAlert.create({ college: ctx.college._id, student: ctx.students[0].profile._id, subject: sub._id, status: 'active', attended: 0, eligible: 1, percentage: 0, threshold: 75 });
  await M.AttendanceAlert.create({ college: ctx.college._id, student: ctx.students[1].profile._id, subject: sub._id, status: 'active', attended: 0, eligible: 1, percentage: 0, threshold: 75 });

  const mine = (await t2.get('/api/mentor/attendance-watch')).body.data;   // t2 mentors student 0 only
  assert.deepEqual(mine.alerts.map(a => a.rollNo), [ctx.students[0].profile.rollNo]);
  assert.ok(mine.atRisk.rows.every(r => r.flags.every(f => f.code === 'attendance')), 'attendance flags only');
  assert.ok(!JSON.stringify(mine).includes('Overdue fees'));
  assert.deepEqual((await t1.get('/api/mentor/attendance-watch')).body.data.alerts, [], 'a teacher with no mentees sees nothing');
  for (const agent of [s1, hod, librarian]) assert.equal((await agent.get('/api/mentor/attendance-watch')).status, 403);
});
