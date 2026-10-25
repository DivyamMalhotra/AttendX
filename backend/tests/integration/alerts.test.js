const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');
const { todayISO, addDays } = require('../../src/utils/dates');
const { TIME_SLOTS } = require('../../src/config/constants');

let ctx; let M; let student; let teacher; let hod; let alerts;
const today = todayISO('Asia/Kolkata');

before(async () => {
  const { models } = await harness.start();
  M = models;
  alerts = require('../../src/services/alertService');
  ctx = await seedCollege(M, { code: 'ALR1', students: 2 });
  student = await harness.login(creds(ctx.college, ctx.students[0].user));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  hod = await harness.login(creds(ctx.college, ctx.hod));
});
after(() => harness.stop());

const profile = () => ctx.students[0].profile;
let dayCounter = 0;

/** Adds `present` + `absent` sessions to Data Structures for student 1 (direct inserts for speed). */
async function addSessions(present, absent) {
  const mk = async status => {
    dayCounter += 1;
    const date = addDays('2025-01-01', dayCounter);
    const s = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date, slot: TIME_SLOTS[1] });
    await M.Attendance.create({ college: ctx.college._id, classSession: s._id, student: profile()._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date, status });
  };
  for (let i = 0; i < present; i += 1) await mk('P');
  for (let i = 0; i < absent; i += 1) await mk('A');
}
const evaluate = async () => alerts.evaluateSubject(await M.College.findById(ctx.college._id), ctx.subjects.ds);
const shortageNotes = () => M.Notification.countDocuments({ user: ctx.students[0].user._id, type: 'attendance_shortage' });
const dash = async () => (await student.get('/api/student/dashboard')).body.data;

test('subjects with no classes produce no alert and no errors', async () => {
  await evaluate();
  assert.equal(await M.AttendanceAlert.countDocuments(), 0);
  const d = await dash();
  assert.equal(d.attendance.overall.percentage, null);
  assert.equal(d.attendance.shortages.length, 0);
});

test('28 of 40 classes (70%) raises one alert and needs the next 8 classes', async () => {
  await addSessions(28, 12);
  await evaluate();
  const alert = await M.AttendanceAlert.findOne({ student: profile()._id });
  assert.equal(alert.status, 'active');
  assert.equal(alert.percentage, 70);
  assert.equal(await shortageNotes(), 1);

  const d = await dash();
  const row = d.attendance.shortages[0];
  assert.equal(row.subject.name, 'Data Structures');
  assert.deepEqual([row.attended, row.missed, row.eligible, row.percentage, row.classesNeeded], [28, 12, 40, 70, 8]);
  assert.equal(d.attendance.threshold, 75);
});

test('refreshing / re-evaluating does not create duplicate alerts or notifications', async () => {
  for (let i = 0; i < 5; i += 1) { await evaluate(); await dash(); }
  assert.equal(await M.AttendanceAlert.countDocuments({ student: profile()._id }), 1);
  assert.equal(await shortageNotes(), 1);
  const [a, b] = await Promise.all([evaluate(), evaluate()]);
  assert.equal(await shortageNotes(), 1, 'concurrent evaluations are also safe');
});

test('the existing alert is updated in place when attendance changes but still short', async () => {
  await addSessions(0, 1);   // 28/41
  await evaluate();
  const note = await M.Notification.findOne({ user: ctx.students[0].user._id, type: 'attendance_shortage' });
  assert.match(note.message, /68\.3%/);
  assert.equal(await shortageNotes(), 1);
  const alert = await M.AttendanceAlert.findOne({ student: profile()._id });
  assert.equal(alert.eligible, 41);
});

test('reaching exactly 75% resolves the alert and sends one recovery notice', async () => {
  // 28/41 -> attend 9 more = 37/50 (74%) ... need (28+x)/(41+x) >= .75 -> x = 11 -> 39/52 = 75%
  await addSessions(10, 0);
  await evaluate();
  assert.equal((await M.AttendanceAlert.findOne({ student: profile()._id })).status, 'active', '38/51 is still short');
  await addSessions(1, 0);
  await evaluate();
  const alert = await M.AttendanceAlert.findOne({ student: profile()._id });
  assert.equal(alert.percentage, 75);
  assert.equal(alert.status, 'resolved', 'exactly at the threshold is not a shortage');
  assert.equal(await M.Notification.countDocuments({ type: 'attendance_recovered' }), 1);
  await evaluate();
  assert.equal(await M.Notification.countDocuments({ type: 'attendance_recovered' }), 1);
  assert.equal((await dash()).attendance.shortages.length, 0);
});

test('falling below again opens a new cycle with a fresh notification', async () => {
  await addSessions(0, 1);
  await evaluate();
  const alert = await M.AttendanceAlert.findOne({ student: profile()._id });
  assert.equal(alert.status, 'active');
  assert.equal(alert.cycle, 2);
  assert.equal(await shortageNotes(), 2);
});

test('marking attendance through the API recalculates alerts for the whole class', async () => {
  const before = await M.Notification.countDocuments({ user: ctx.students[1].user._id, type: 'attendance_shortage' });
  const records = ctx.students.map(s => ({ studentId: String(s.profile._id), status: 'A' }));
  const res = await teacher.put('/api/faculty/attendance/sessions', { subjectId: String(ctx.subjects.ds._id), date: today, slot: TIME_SLOTS[4], records });
  assert.equal(res.status, 201);
  // student 2 had one session and is now 0/2 => shortage alert for them too
  const after = await M.Notification.countDocuments({ user: ctx.students[1].user._id, type: 'attendance_shortage' });
  assert.equal(after, before + 1);
  // correcting the session recalculates again (no duplicate for student 2)
  const fixed = ctx.students.map(s => ({ studentId: String(s.profile._id), status: 'P' }));
  await teacher.put('/api/faculty/attendance/sessions', { subjectId: String(ctx.subjects.ds._id), date: today, slot: TIME_SLOTS[4], records: fixed });
  assert.equal(await M.Notification.countDocuments({ user: ctx.students[1].user._id, type: 'attendance_shortage' }), after);
  assert.equal((await M.AttendanceAlert.findOne({ student: ctx.students[1].profile._id })).status, 'resolved');
});

test('changing the threshold re-evaluates everyone', async () => {
  const res = await hod.patch('/api/admin/settings', { attendanceThreshold: 60 });
  assert.equal(res.status, 200);
  assert.equal((await M.AttendanceAlert.findOne({ student: profile()._id })).status, 'resolved', 'about 71% is above a 60% threshold');
  const d = await dash();
  assert.equal(d.attendance.threshold, 60);
  await hod.patch('/api/admin/settings', { attendanceThreshold: 75 });
  assert.equal((await M.AttendanceAlert.findOne({ student: profile()._id })).status, 'active');
  assert.equal((await hod.patch('/api/admin/settings', { attendanceThreshold: 101 })).status, 400);
});

test('students cannot alter settings, alerts or notifications of others', async () => {
  assert.equal((await student.patch('/api/admin/settings', { attendanceThreshold: 1 })).status, 403);
  const note = await M.Notification.findOne({ user: ctx.students[1].user._id });
  const other = await student.post(`/api/student/notifications/${note._id}/read`);
  assert.equal(other.status, 200);
  assert.equal((await M.Notification.findById(note._id)).read, false, 'someone else\'s notification is untouched');
});

test('notifications can be listed and marked read by their owner', async () => {
  const list = await student.get('/api/student/notifications');
  assert.ok(list.body.meta.unread > 0);
  await student.post('/api/student/notifications/read-all');
  assert.equal((await student.get('/api/student/notifications')).body.meta.unread, 0);
});

test('administrators can monitor active shortages and export the attendance report', async () => {
  const active = await hod.get('/api/admin/attendance/alerts');
  assert.equal(active.status, 200);
  assert.ok(active.body.data.length >= 1);
  const csv = await hod.get('/api/admin/attendance/report?format=csv&belowThreshold=true');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Roll No,Name/);
});
