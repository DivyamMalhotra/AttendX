const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');
const { todayISO, addDays } = require('../../src/utils/dates');

let ctx; let M; let s1; let s2; let mentor; let otherTeacher; let hod;
const today = todayISO('Asia/Kolkata');
const D = n => addDays(today, n);

const apply = (agent, over = {}) => agent.post('/api/student/duty-leaves', { fromDate: D(-1), toDate: D(-1), reason: 'Inter-college sports meet', ...over });

before(async () => {
  const { models } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'DUTY1' });
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
  mentor = await harness.login(creds(ctx.college, ctx.teacher));
  otherTeacher = await harness.login(creds(ctx.college, ctx.teacher2));
  hod = await harness.login(creds(ctx.college, ctx.hod));
});
after(() => harness.stop());

const reset = async () => {
  await M.DutyLeaveRequest.deleteMany({});
  await M.DutyLeaveDay.deleteMany({});
  await M.Attendance.deleteMany({});
  await M.ClassSession.deleteMany({});
  await M.AttendanceAlert.deleteMany({});
  await M.Notification.deleteMany({});
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.allowResubmitAfterRejection': true, 'settings.dutyLeavePolicy': 'exclude' } });
};

test('a valid application is stored as pending with one day row per date', async () => {
  await reset();
  const res = await apply(s1, { fromDate: D(-3), toDate: D(-1) });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(await M.DutyLeaveDay.countDocuments({ active: true }), 3);
});

test('duplicate application for the same date is rejected with a clear message (original bug)', async () => {
  const dup = await apply(s1, { fromDate: D(-1), toDate: D(-1) });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'DUTY_LEAVE_DUPLICATE');
  assert.match(dup.body.error.message, /already have a pending duty leave/);
  const overlap = await apply(s1, { fromDate: D(-2), toDate: D(2) });
  assert.equal(overlap.status, 409);
  assert.equal(await M.DutyLeaveRequest.countDocuments(), 1, 'rejected submissions leave nothing behind');
  assert.equal(await M.DutyLeaveDay.countDocuments(), 3);
});

test('another student may apply for the same dates', async () => {
  assert.equal((await apply(s2, { fromDate: D(-1), toDate: D(-1) })).status, 201);
});

test('simultaneous submissions for the same date store exactly one request', async () => {
  await reset();
  const results = await Promise.all(Array.from({ length: 10 }, () => apply(s1, { fromDate: D(-5), toDate: D(-4) })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.ok(results.filter(r => r.status !== 201).every(r => r.status === 409));
  assert.equal(await M.DutyLeaveRequest.countDocuments(), 1);
  assert.equal(await M.DutyLeaveDay.countDocuments(), 2);
});

test('the database itself blocks two active rows for one student and date', async () => {
  const day = await M.DutyLeaveDay.findOne({ active: true });
  await assert.rejects(M.DutyLeaveDay.create({
    college: day.college, student: day.student, request: day.request, date: day.date, state: 'pending', active: true
  }), /E11000/);
});

test('invalid ranges and dates are rejected', async () => {
  await reset();
  assert.equal((await apply(s1, { fromDate: D(2), toDate: D(1) })).body.error.code, 'INVALID_RANGE');
  assert.equal((await apply(s1, { fromDate: D(-90), toDate: D(-89) })).body.error.code, 'DATE_TOO_OLD');
  assert.equal((await apply(s1, { fromDate: D(1), toDate: D(60) })).body.error.code, 'RANGE_TOO_LONG');
  assert.equal((await apply(s1, { fromDate: '2026-02-30', toDate: '2026-03-01' })).status, 400);
  assert.equal((await apply(s1, { reason: '' })).status, 400);
});

test('only the assigned mentor can review; students, other faculty and the Administrator cannot', async () => {
  await reset();
  const { body } = await apply(s1);
  const id = body.data.id;
  const review = (agent, decision = 'approved') => agent.post(`/api/duty-leaves/${id}/review`, { decision, remark: 'ok' });
  assert.equal((await review(s1)).status, 403);
  assert.equal((await review(otherTeacher)).status, 403);
  assert.equal((await review(mentor)).status, 200);
  const queue = await otherTeacher.get('/api/duty-leaves/review');
  assert.equal(queue.body.data.length, 0, 'non-mentor sees no requests');
  assert.equal((await mentor.get('/api/duty-leaves/review')).body.data.length, 1);
  assert.equal((await hod.get('/api/duty-leaves/review')).status, 403, 'the Administrator does not decide leave');
  assert.equal((await hod.post(`/api/duty-leaves/${id}/review`, { decision: 'rejected' })).status, 403);
});

test('status transitions are controlled and audited; approval cannot be applied twice', async () => {
  await reset();
  const id = (await apply(s1)).body.data.id;
  const [a, b] = await Promise.all([
    mentor.post(`/api/duty-leaves/${id}/review`, { decision: 'approved' }),
    mentor.post(`/api/duty-leaves/${id}/review`, { decision: 'approved' })
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const again = await mentor.post(`/api/duty-leaves/${id}/review`, { decision: 'rejected' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'INVALID_TRANSITION');
  const doc = await M.DutyLeaveRequest.findById(id);
  assert.equal(doc.status, 'approved');
  assert.equal(doc.history.length, 2, 'submitted + one decision');
  assert.equal(await M.AuditLog.countDocuments({ action: 'dutyleave.approved', entityId: id }), 1);
  assert.equal(await M.Notification.countDocuments({ type: 'duty_leave' }), 1);
});

test('after rejection the student may resubmit when policy allows, and cannot when it does not', async () => {
  await reset();
  const id = (await apply(s1)).body.data.id;
  await mentor.post(`/api/duty-leaves/${id}/review`, { decision: 'rejected', remark: 'Need proof' });
  const again = await apply(s1);
  assert.equal(again.status, 201);

  await reset();
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.allowResubmitAfterRejection': false } });
  const id2 = (await apply(s1)).body.data.id;
  await mentor.post(`/api/duty-leaves/${id2}/review`, { decision: 'rejected' });
  const blocked = await apply(s1);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /not permitted/);
});

test('students can cancel pending requests (releasing the dates) but not approved ones', async () => {
  await reset();
  const id = (await apply(s1)).body.data.id;
  assert.equal((await s1.post(`/api/student/duty-leaves/${id}/cancel`)).status, 200);
  assert.equal((await apply(s1)).status, 201);
  const approved = (await apply(s1, { fromDate: D(3), toDate: D(3) })).body.data.id;
  await mentor.post(`/api/duty-leaves/${approved}/review`, { decision: 'approved' });
  assert.equal((await s1.post(`/api/student/duty-leaves/${approved}/cancel`)).status, 409);
  assert.equal((await s2.post(`/api/student/duty-leaves/${approved}/cancel`)).status, 404, 'other students cannot touch it');
});

/** Builds N sessions for DS where student 1 is absent on the given offsets and present otherwise. */
async function seedAttendance(absentOffsets, presentOffsets) {
  const { TIME_SLOTS } = require('../../src/config/constants');
  const student = ctx.students[0].profile;
  for (const [offsets, status] of [[absentOffsets, 'A'], [presentOffsets, 'P']]) {
    for (const off of offsets) {
      const session = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date: D(off), slot: TIME_SLOTS[1] });
      await M.Attendance.create({ college: ctx.college._id, classSession: session._id, student: student._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date: D(off), status });
    }
  }
}
const dsStats = async () => (await s1.get('/api/student/attendance')).body.data.subjects.find(x => x.subject.name === 'Data Structures');

test('approved duty leave exempts absences at read time; pending/rejected do not; present records are never double counted', async () => {
  await reset();
  await seedAttendance([-4, -3], [-2, -1, -5]);   // 3 present, 2 absent
  let ds = await dsStats();
  assert.deepEqual([ds.attended, ds.eligible, ds.exempt], [3, 5, 0]);

  const pending = (await apply(s1, { fromDate: D(-4), toDate: D(-2) })).body.data.id;   // covers an absence, an absence, a present
  ds = await dsStats();
  assert.equal(ds.exempt, 0, 'pending leave is not an exemption');

  await mentor.post(`/api/duty-leaves/${pending}/review`, { decision: 'approved' });
  ds = await dsStats();
  assert.equal(ds.exempt, 2, 'only the two ABSENT days are exempt; the present day is not');
  assert.equal(ds.attended, 3);
  assert.equal(ds.eligible, 3, 'exempt absences leave the denominator');
  assert.equal(ds.percentage, 100);

  // approving again is impossible, and attendance rows were never rewritten
  assert.equal((await mentor.post(`/api/duty-leaves/${pending}/review`, { decision: 'approved' })).status, 409);
  assert.equal(await M.Attendance.countDocuments({ status: 'A' }), 2);
  ds = await dsStats();
  assert.equal(ds.eligible, 3);
});

test('policy "count_present" credits exempt absences as attended', async () => {
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.dutyLeavePolicy': 'count_present' } });
  const ds = await dsStats();
  assert.deepEqual([ds.attended, ds.eligible, ds.exempt, ds.missed], [5, 5, 2, 0]);
});

test('a rejected request gives no exemption', async () => {
  await reset();
  await seedAttendance([-4], [-3]);
  const id = (await apply(s1, { fromDate: D(-4), toDate: D(-4) })).body.data.id;
  await mentor.post(`/api/duty-leaves/${id}/review`, { decision: 'rejected' });
  const ds = await dsStats();
  assert.deepEqual([ds.attended, ds.eligible, ds.exempt], [1, 2, 0]);
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

test('supporting documents: type, content and size are validated; access is restricted', async () => {
  await reset();
  const post = (buf, name, type, extra = {}) => s1.raw.post('/api/student/duty-leaves').set('X-CSRF-Token', s1.csrf)
    .field('fromDate', extra.from || D(-1)).field('toDate', extra.to || D(-1)).field('reason', 'Hackathon')
    .attach('document', buf, { filename: name, contentType: type });

  assert.equal((await post(Buffer.from('MZ-not-a-pdf'), 'proof.pdf', 'application/pdf')).body.error.code, 'UNSUPPORTED_FILE_TYPE', 'content must match declared type');
  assert.equal((await post(Buffer.from('<?php echo 1;'), 'shell.php', 'application/x-php')).body.error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal((await post(Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024)]), 'big.pdf', 'application/pdf')).status, 413);
  assert.equal(await M.DutyLeaveRequest.countDocuments(), 0, 'failed uploads create no request');

  const ok = await post(PDF, '../../evil name.pdf', 'application/pdf');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.hasDocument, true);
  const stored = (await M.DutyLeaveRequest.findById(ok.body.data.id)).document;
  assert.match(stored.storedName, /^[a-f0-9]{32}\.pdf$/, 'server generated file name');

  const url = `/api/duty-leaves/${ok.body.data.id}/document`;
  const owner = await s1.get(url);
  assert.equal(owner.status, 200);
  assert.equal(owner.headers['content-type'], 'application/pdf');
  assert.equal((await mentor.get(url)).status, 200);
  assert.equal((await hod.get(url)).status, 403, 'the Administrator is not an approver');
  assert.equal((await s2.get(url)).status, 403, 'another student');
  assert.equal((await otherTeacher.get(url)).status, 403, 'a teacher who is not the mentor');
  const files = require('fs').readdirSync(require('path').join(process.env.UPLOAD_DIR, 'duty-leave'));
  assert.equal(files.length, 1, 'rejected uploads were cleaned up');
});
