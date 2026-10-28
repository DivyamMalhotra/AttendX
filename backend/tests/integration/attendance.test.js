const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');
const { todayISO, addDays } = require('../../src/utils/dates');
const { TIME_SLOTS } = require('../../src/config/constants');

let ctx; let M; let teacher; let teacher2; let hod;
const today = todayISO('Asia/Kolkata');
const [S1, S2, S3] = TIME_SLOTS;

const records = (statuses = []) => ctx.students.map((s, i) => ({ studentId: String(s.profile._id), status: statuses[i] || 'P' }));
const put = (agent, subject, over = {}) => agent.put('/api/faculty/attendance/sessions', {
  subjectId: String(subject._id), date: today, slot: S1, records: records(), ...over
});

before(async () => {
  const { models } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'ATT1' });
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  teacher2 = await harness.login(creds(ctx.college, ctx.teacher2));
  hod = await harness.login(creds(ctx.college, ctx.hod));
});
after(() => harness.stop());

test('faculty can mark attendance for a new class session', async () => {
  const res = await put(teacher, ctx.subjects.ds);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.created, true);
  assert.deepEqual(res.body.data.counts, { present: 4, absent: 0 });
  assert.equal(await M.Attendance.countDocuments({ classSession: res.body.data.sessionId }), 4);
});

test('a different subject on the same date is not blocked by the first (original bug)', async () => {
  const res = await put(teacher2, ctx.subjects.os, { slot: S1 });
  assert.equal(res.status, 201);
  assert.equal(await M.ClassSession.countDocuments({ date: today }), 2);
});

test('several legitimate sessions of one subject on the same date are supported', async () => {
  const res = await put(teacher, ctx.subjects.ds, { slot: S2 });
  assert.equal(res.status, 201);
  assert.equal(await M.ClassSession.countDocuments({ subject: ctx.subjects.ds._id, date: today }), 2);
});

test('submitting the same session again never duplicates records and acts as a correction', async () => {
  const before = await M.Attendance.countDocuments();
  const res = await put(teacher, ctx.subjects.ds, { slot: S1, records: records(['A', 'P', 'P', 'P']) });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.created, false);
  assert.equal(res.body.data.changedRecords, 1);
  assert.equal(await M.Attendance.countDocuments(), before);
  const row = await M.Attendance.findOne({ classSession: res.body.data.sessionId, student: ctx.students[0].profile._id });
  assert.equal(row.status, 'A');
  assert.ok(await M.AuditLog.exists({ action: 'attendance.corrected' }));
});

test('expectNew refuses to overwrite an already submitted session and reports its id', async () => {
  const res = await put(teacher, ctx.subjects.ds, { slot: S1, expectNew: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'SESSION_EXISTS');
  assert.ok(res.body.error.details.sessionId);
});

test('lookup tells the UI whether a session was already submitted', async () => {
  const q = (slot) => teacher.get(`/api/faculty/attendance/lookup?subjectId=${ctx.subjects.ds._id}&date=${today}&slot=${encodeURIComponent(slot)}`);
  assert.equal((await q(S1)).body.data.exists, true);
  assert.equal((await q(S3)).body.data.exists, false);
});

test('concurrent identical submissions cannot create duplicate sessions or records', async () => {
  const date = addDays(today, -1);
  const results = await Promise.all(Array.from({ length: 12 }, () => put(teacher, ctx.subjects.ds, { date, slot: S3 })));
  assert.ok(results.every(r => [200, 201].includes(r.status)), JSON.stringify(results.map(r => r.status)));
  assert.equal(results.filter(r => r.status === 201).length, 1, 'exactly one request creates the session');
  const sessions = await M.ClassSession.find({ subject: ctx.subjects.ds._id, date, slot: S3 });
  assert.equal(sessions.length, 1);
  assert.equal(await M.Attendance.countDocuments({ classSession: sessions[0]._id }), 4);
});

test('the database itself rejects duplicate session / attendance rows', async () => {
  const s = await M.ClassSession.findOne({ subject: ctx.subjects.ds._id, date: today, slot: S1 });
  await assert.rejects(M.ClassSession.create({ college: ctx.college._id, subject: s.subject, section: s.section, date: s.date, slot: s.slot }), /E11000/);
  await assert.rejects(M.Attendance.create({
    college: ctx.college._id, classSession: s._id, student: ctx.students[0].profile._id, subject: s.subject, section: s.section, date: s.date, status: 'P'
  }), /E11000/);
});

test('unauthorized and invalid submissions are rejected', async () => {
  // teacher 1 does not teach Operating Systems
  assert.equal((await put(teacher, ctx.subjects.os, { slot: S2 })).status, 403);
  // students cannot mark attendance
  const student = await harness.login(creds(ctx.college, ctx.students[0].user));
  assert.equal((await put(student, ctx.subjects.ds, { slot: S2 })).status, 403);
  // future and impossible dates
  assert.equal((await put(teacher, ctx.subjects.ds, { date: addDays(today, 2) })).body.error.code, 'FUTURE_DATE');
  assert.equal((await put(teacher, ctx.subjects.ds, { date: '2026-02-30' })).status, 400);
  assert.equal((await put(teacher, ctx.subjects.ds, { slot: '3:33 AM' })).status, 400);
  // incomplete / foreign / duplicated student lists
  assert.equal((await put(teacher, ctx.subjects.ds, { records: records().slice(1) })).body.error.code, 'INCOMPLETE_ATTENDANCE');
  const dup = records(); dup[1] = dup[0];
  assert.equal((await put(teacher, ctx.subjects.ds, { records: dup })).status, 400);
  const foreign = records(); foreign[0] = { studentId: String(ctx.hod._id), status: 'P' };
  assert.equal((await put(teacher, ctx.subjects.ds, { records: foreign })).body.error.code, 'STUDENT_NOT_ENROLLED');
});

test('faculty cannot reach summaries or sessions of subjects assigned to someone else', async () => {
  assert.equal((await teacher.get(`/api/faculty/subjects/${ctx.subjects.os._id}/summary`)).status, 403);
  assert.equal((await teacher2.get(`/api/faculty/subjects/${ctx.subjects.os._id}/summary`)).status, 200);
  const dsSession = await M.ClassSession.findOne({ subject: ctx.subjects.ds._id });
  assert.equal((await teacher2.get(`/api/faculty/attendance/sessions/${dsSession._id}`)).status, 403);
});

test('edit window: faculty cannot change old attendance but the HOD can', async () => {
  const old = addDays(today, -60);
  assert.equal((await put(teacher, ctx.subjects.ds, { date: old })).status, 403);
  assert.equal((await put(hod, ctx.subjects.ds, { date: old })).status, 201);
});

test('sessions can be edited and moved without colliding with an existing one', async () => {
  const session = await M.ClassSession.findOne({ subject: ctx.subjects.ds._id, date: today, slot: S2 });
  const clash = await teacher.put(`/api/faculty/attendance/sessions/${session._id}`, { date: today, slot: S1, records: records() });
  assert.equal(clash.status, 409);
  const ok = await teacher.put(`/api/faculty/attendance/sessions/${session._id}`, { date: addDays(today, -2), slot: S2, records: records(['P', 'A', 'A', 'P']) });
  assert.equal(ok.status, 200);
  const moved = await M.Attendance.find({ classSession: session._id });
  assert.ok(moved.every(a => a.date === addDays(today, -2)));
});

test('student dashboard shows accurate subject-wise percentages', async () => {
  const student = await harness.login(creds(ctx.college, ctx.students[0].user));
  const res = await student.get('/api/student/attendance');
  assert.equal(res.status, 200);
  const ds = res.body.data.subjects.find(s => s.subject.name === 'Data Structures');
  const os = res.body.data.subjects.find(s => s.subject.name === 'Operating Systems');
  // Student 1 on DS: absent S1(today), present S2(moved), present S3(yesterday), present old(60d) => 3/4
  assert.equal(ds.eligible, 4);
  assert.equal(ds.attended, 3);
  assert.equal(ds.percentage, 75);
  assert.equal(os.eligible, 1);
  assert.equal(os.percentage, 100);
  assert.equal(res.body.data.threshold, 75);
});
