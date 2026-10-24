const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');
const { multipart, file, PDF } = require('../helpers/multipart');
const { todayISO, addDays } = require('../../src/utils/dates');
const { TIME_SLOTS } = require('../../src/config/constants');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let mentor; let t2; let s1; let s2; let types;
const today = todayISO('Asia/Kolkata');
const D = n => addDays(today, n);

const apply = (agent, fields, files = []) => multipart(agent, 'post', '/api/student/duty-leaves', { reason: 'Reason given', fromDate: D(-1), toDate: D(-1), ...fields }, files.map(f => ({ ...f, field: 'document' })));
const typeId = key => String(types.find(t => t.key === key)._id);
const reset = async () => { await M.DutyLeaveRequest.deleteMany({}); await M.DutyLeaveDay.deleteMany({}); await M.Attendance.deleteMany({}); await M.ClassSession.deleteMany({}); await M.Notification.deleteMany({}); };
const dsStats = async () => (await s1.get('/api/student/attendance')).body.data.subjects.find(x => x.subject.name === 'Data Structures');

async function seedAbsences(offsets) {
  for (const off of offsets) {
    const session = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date: D(off), slot: TIME_SLOTS[1] });
    await M.Attendance.create({ college: ctx.college._id, classSession: session._id, student: ctx.students[0].profile._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date: D(off), status: 'A' });
  }
}

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'LVT1', students: 2 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  mentor = await harness.login(creds(ctx.college, ctx.teacher));      // mentor of the section
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
  types = (await hod.get('/api/admin/leave-types')).body.data;
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('every college gets duty, medical and personal leave types; students can list the active ones', async () => {
  assert.deepEqual(types.map(t => t.key).sort(), ['duty', 'medical', 'personal']);
  const med = types.find(t => t.key === 'medical');
  assert.deepEqual([med.requiresDocument, med.sensitive, med.exemptsAttendance], [true, true, false]);
  assert.equal(types.find(t => t.key === 'duty').exemptsAttendance, true);
  const mine = (await s1.get('/api/student/leave-types')).body.data;
  assert.equal(mine.length, 3);
  assert.ok(!('sensitive' in mine[0]) && !('exemptsAttendance' in mine[0]), 'internal flags are not sent to students');
  assert.equal((await mentor.get('/api/admin/leave-types')).status, 403);
  assert.equal((await mentor.post('/api/admin/leave-types', { key: 'x1', name: 'X' })).status, 403);
});

test('a leave type can require a document, cap its length, and is validated server-side', async () => {
  await reset();
  assert.equal((await apply(s1, { leaveTypeId: typeId('medical') })).body.error.code, 'DOCUMENT_REQUIRED');
  assert.equal((await apply(s1, { leaveTypeId: typeId('medical') }, [file('cert.pdf')])).status, 201);
  await hod.patch(`/api/admin/leave-types/${typeId('personal')}`, { maxDaysPerRequest: 3 });
  assert.equal((await apply(s1, { leaveTypeId: typeId('personal'), fromDate: D(2), toDate: D(5) })).body.error.code, 'RANGE_TOO_LONG');
  assert.equal((await apply(s1, { leaveTypeId: typeId('personal'), fromDate: D(2), toDate: D(4) })).status, 201);
  assert.equal((await apply(s1, { leaveTypeId: '64b7f0f0f0f0f0f0f0f0f0f0', fromDate: D(8), toDate: D(8) })).body.error.code, 'LEAVE_TYPE_NOT_FOUND');
  const off = await hod.post('/api/admin/leave-types', { key: 'sabbatical', name: 'Sabbatical', active: false });
  assert.equal(off.status, 201);
  assert.equal((await apply(s1, { leaveTypeId: off.body.data._id, fromDate: D(9), toDate: D(9) })).body.error.code, 'LEAVE_TYPE_NOT_FOUND', 'inactive types cannot be used');
  assert.equal((await hod.post('/api/admin/leave-types', { key: 'sabbatical', name: 'Again' })).status, 409);
});

test('applications of different types for the same date are blocked as duplicates', async () => {
  await reset();
  assert.equal((await apply(s1, { leaveTypeId: typeId('medical'), fromDate: D(-2), toDate: D(-1) }, [file()])).status, 201);
  const dup = await apply(s1, { leaveTypeId: typeId('duty'), fromDate: D(-1), toDate: D(-1) });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error.message, /already have a pending medical leave request/);
});

test('attendance is only adjusted by leave types that are configured to exempt it', async () => {
  await reset();
  await seedAbsences([-3, -2]);
  assert.equal((await dsStats()).eligible, 2);

  const medical = (await apply(s1, { leaveTypeId: typeId('medical'), fromDate: D(-3), toDate: D(-3) }, [file()])).body.data.id;
  assert.equal((await hod.post(`/api/duty-leaves/${medical}/review`, { decision: 'approved' })).status, 200);
  let ds = await dsStats();
  assert.deepEqual([ds.eligible, ds.exempt], [2, 0], 'approved medical leave does not change attendance by default');

  await hod.patch(`/api/admin/leave-types/${typeId('personal')}`, { exemptsAttendance: true, maxDaysPerRequest: 5 });
  const personal = (await apply(s1, { leaveTypeId: typeId('personal'), fromDate: D(-2), toDate: D(-2) })).body.data.id;
  await mentor.post(`/api/duty-leaves/${personal}/review`, { decision: 'approved' });
  ds = await dsStats();
  assert.deepEqual([ds.eligible, ds.exempt], [1, 1], 'the administrator made personal leave exempt, so it now does');

  // existing requests keep the policy they were made under (the day rows carry it)
  await hod.patch(`/api/admin/leave-types/${typeId('medical')}`, { exemptsAttendance: true });
  assert.equal((await dsStats()).exempt, 1, 'past approvals are not rewritten by a later policy change');
});

test('medical leave is only visible to medical reviewers: not to mentors, other faculty or other students', async () => {
  await reset();
  const med = (await apply(s1, { leaveTypeId: typeId('medical'), reason: 'Surgery recovery' }, [file('discharge.pdf')])).body.data;
  const duty = (await apply(s1, { leaveTypeId: typeId('duty'), fromDate: D(-5), toDate: D(-5) })).body.data;

  const mentorQueue = (await mentor.get('/api/duty-leaves/review')).body.data;
  assert.deepEqual(mentorQueue.map(r => r.id), [duty.id], 'the mentor sees the duty request, never the medical one');
  assert.ok(!JSON.stringify(mentorQueue).includes('Surgery'));
  assert.equal((await mentor.post(`/api/duty-leaves/${med.id}/review`, { decision: 'approved' })).status, 403);
  assert.equal((await mentor.get(`/api/duty-leaves/${med.id}/document`)).status, 403);
  assert.equal((await t2.get(`/api/duty-leaves/${med.id}/document`)).status, 403);
  assert.equal((await s2.get(`/api/duty-leaves/${med.id}/document`)).status, 403);

  const hodQueue = (await hod.get('/api/duty-leaves/review')).body.data;
  assert.ok(hodQueue.some(r => r.id === med.id && r.leaveType.sensitive));
  const doc = await hod.get(`/api/duty-leaves/${med.id}/document`);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers['content-type'], 'application/pdf');
  assert.equal((await s1.get(`/api/duty-leaves/${med.id}/document`)).status, 200, 'the student owns it');

  const clerk = await require('../helpers/fixtures').makeStaff({ harness, hod, M, ctx, roleKey: 'registrar', email: 'reg@lvt1.edu' });
  assert.equal((await clerk.get(`/api/duty-leaves/${med.id}/document`)).status, 403, 'leave.review is not enough for medical');
  assert.ok(!(await clerk.get('/api/duty-leaves/review')).body.data.some(r => r.id === med.id));
});

test('medical decisions are audited but the reviewer remark stays out of the notification text', async () => {
  const med = await M.DutyLeaveRequest.findOne({ leaveType: typeId('medical'), status: 'pending' });
  await hod.post(`/api/duty-leaves/${med._id}/review`, { decision: 'rejected', remark: 'Certificate unclear: knee surgery' });
  const note = await M.Notification.findOne({ user: ctx.students[0].user._id, title: /Medical leave rejected/ });
  assert.ok(note);
  assert.ok(!/knee|surgery|Certificate/i.test(note.message));
  const audit = await M.AuditLog.findOne({ action: 'dutyleave.rejected', entityId: String(med._id) });
  assert.equal(audit.meta.remark, undefined);
  const mine = (await s1.get('/api/student/duty-leaves')).body.data.find(r => r.id === String(med._id));
  assert.equal(mine.remark, 'Certificate unclear: knee surgery', 'the student can still read the remark in the app');
});
