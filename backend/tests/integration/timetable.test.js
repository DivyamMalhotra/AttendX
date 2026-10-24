const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, PASSWORD } = require('../helpers/fixtures');
const { todayISO, addDays } = require('../../src/utils/dates');
const { isoWeekday } = require('../../src/utils/time');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let t1; let t2; let lifecycle; let timetables;
const TZ = 'Asia/Kolkata';
const today = todayISO(TZ);
const dow = isoWeekday(today);
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`);

const entry = (over = {}) => ({ subjectId: String(ctx.subjects.ds._id), dayOfWeek: dow, startTime: '09:00', endTime: '10:00', room: 'R1', ...over });
const draft = async (over = {}) => (await hod.post('/api/timetable', { sectionId: String(ctx.section._id), academicSessionId: String(ctx.academicSession._id), effectiveFrom: addDays(today, -30), ...over })).body.data;

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  lifecycle = require('../../src/services/sessionLifecycleService');
  timetables = require('../../src/services/timetableService');
  ctx = await seedCollege(M, { code: 'TT1', students: 3 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
});
after(async () => { removeFakeProviders(); await harness.stop(); });

const reset = async () => {
  await M.ClassSession.deleteMany({}); await M.Attendance.deleteMany({});
  await M.TimetableEntry.deleteMany({}); await M.Timetable.deleteMany({});
  await M.Notification.deleteMany({});
};
const freshCollege = () => M.College.findById(ctx.college._id);

test('only authorised users manage timetables', async () => {
  assert.equal((await t1.post('/api/timetable', {})).status, 403);
  const student = await harness.login(creds(ctx.college, ctx.students[0].user));
  assert.equal((await student.get('/api/timetable')).status, 403);
  assert.equal((await hod.get('/api/timetable')).status, 200);
});

test('entries are validated and clashes (teacher, section, room) are blocked unless knowingly overridden', async () => {
  await reset();
  const tt = await draft();
  assert.equal(tt.status, 'draft');
  assert.equal(tt.version, 1);

  assert.equal((await hod.post(`/api/timetable/${tt._id}/entries`, entry({ startTime: '10:00', endTime: '09:00' }))).body.error.code, 'INVALID_TIME');
  assert.equal((await hod.post(`/api/timetable/${tt._id}/entries`, entry({ startTime: '25:00' }))).status, 400);
  assert.equal((await hod.post(`/api/timetable/${tt._id}/entries`, entry({ teacherId: String(ctx.hod._id) }))).body.error.code, 'TEACHER_REQUIRED');

  assert.equal((await hod.post(`/api/timetable/${tt._id}/entries`, entry())).status, 201);
  // same section, overlapping time, different subject -> section clash (and teacher clash is not involved)
  const sectionClash = await hod.post(`/api/timetable/${tt._id}/entries`, entry({ subjectId: String(ctx.subjects.os._id), startTime: '09:30', endTime: '10:30', room: 'R9' }));
  assert.equal(sectionClash.status, 409);
  assert.deepEqual(sectionClash.body.error.details.map(d => d.kind), ['section']);
  // back-to-back is fine
  assert.equal((await hod.post(`/api/timetable/${tt._id}/entries`, entry({ subjectId: String(ctx.subjects.os._id), startTime: '10:00', endTime: '11:00', room: 'R2' }))).status, 201);

  // another section: same teacher/time -> teacher clash; same room/time -> room clash
  const sec2 = await M.Section.create({ college: ctx.college._id, name: 'CS-C', nameKey: 'cs-c', sem: 'Sem 3', semesterNumber: 3 });
  const ds2 = await M.Subject.create({ college: ctx.college._id, section: sec2._id, name: 'DS', nameKey: 'ds', teacher: ctx.teacher._id });
  const other = (await hod.post('/api/timetable', { sectionId: String(sec2._id), academicSessionId: String(ctx.academicSession._id), effectiveFrom: addDays(today, -30) })).body.data;
  const empty = (await hod.post('/api/timetable', { sectionId: String(sec2._id), academicSessionId: String(ctx.academicSession._id), effectiveFrom: addDays(today, -10), copyFromLatest: false }));
  assert.equal(empty.status, 201);
  assert.equal(empty.body.data.version, 2, 'a new draft for the same section is the next version');
  assert.equal((await hod.post(`/api/timetable/${empty.body.data._id}/approve`)).body.error.code, 'EMPTY_TIMETABLE');

  const clashTeacher = await hod.post(`/api/timetable/${other._id}/entries`, { subjectId: String(ds2._id), dayOfWeek: dow, startTime: '09:00', endTime: '10:00', room: 'Z' });
  assert.equal(clashTeacher.status, 201, 'the first timetable is still a draft: drafts of other sections do not block each other');
  await hod.post(`/api/timetable/${(await M.Timetable.findOne({ section: ctx.section._id, version: 1 }))._id}/approve`);
  const t2clash = await hod.post(`/api/timetable/${other._id}/entries`, { subjectId: String(ds2._id), dayOfWeek: dow, startTime: '09:15', endTime: '09:45', room: 'Q' });
  assert.ok(t2clash.body.error.details.some(d => d.kind === 'teacher'), 'approved timetables block the same teacher');
  const roomClash = await hod.post(`/api/timetable/${other._id}/entries`, { subjectId: String(ds2._id), teacherId: String(ctx.teacher2._id), dayOfWeek: dow, startTime: '09:15', endTime: '09:45', room: 'r1' });
  assert.ok(roomClash.body.error.details.some(d => d.kind === 'room'));

  const overridden = await hod.post(`/api/timetable/${other._id}/entries`, { subjectId: String(ds2._id), teacherId: String(ctx.teacher2._id), dayOfWeek: dow, startTime: '09:15', endTime: '09:45', room: 'r1', overrideReason: 'Combined lecture hall' });
  assert.equal(overridden.status, 201);
  const row = await M.TimetableEntry.findById(overridden.body.data._id);
  assert.equal(row.override.reason, 'Combined lecture hall');
  assert.ok(await M.AuditLog.exists({ action: 'timetable.entry_override' }));
});

test('approval generates linked class sessions; running generation again (even concurrently) never duplicates', async () => {
  await reset();
  const tt = await draft();
  await hod.post(`/api/timetable/${tt._id}/entries`, entry());
  await hod.post(`/api/timetable/${tt._id}/entries`, entry({ subjectId: String(ctx.subjects.os._id), startTime: '10:00', endTime: '11:00', room: 'R2' }));

  const res = await hod.post(`/api/timetable/${tt._id}/approve`);
  assert.equal(res.status, 200);
  const sessions = await M.ClassSession.find({}).lean();
  const weekdays = Array.from({ length: 15 }, (_, i) => addDays(today, i)).filter(d => isoWeekday(d) === dow).length;
  assert.equal(sessions.length, weekdays * 2);
  const s = sessions.find(x => x.startTime === '09:00');
  assert.equal(s.slot, '9:00 AM – 10:00 AM', 'same label format as the fixed slots');
  assert.equal(s.status, 'scheduled');
  assert.equal(s.source, 'timetable');
  assert.equal(s.room, 'R1');
  assert.ok(s.timetableEntry);
  assert.equal(String(s.teacher), String(ctx.teacher._id));

  const again = await timetables.generate(ctx.college._id, today, addDays(today, 14));
  assert.deepEqual(again, { created: 0, linked: 0, revived: 0 });
  await Promise.all(Array.from({ length: 6 }, () => timetables.generate(ctx.college._id, today, addDays(today, 14))));
  assert.equal(await M.ClassSession.countDocuments(), weekdays * 2);
  assert.equal((await hod.post(`/api/timetable/${tt._id}/approve`)).status, 409, 'cannot approve twice');
  assert.equal((await hod.post(`/api/timetable/${tt._id}/entries`, entry({ startTime: '15:00', endTime: '16:00' }))).body.error.code, 'TIMETABLE_LOCKED');
});

test('an ad hoc session in the same slot is linked to the timetable instead of duplicated', async () => {
  await reset();
  const adhoc = await t1.put('/api/faculty/attendance/sessions', {
    subjectId: String(ctx.subjects.ds._id), date: today, slot: '9:00 AM – 10:00 AM',
    records: ctx.students.map(s => ({ studentId: String(s.profile._id), status: 'P' }))
  });
  assert.equal(adhoc.status, 201);
  const tt = await draft();
  await hod.post(`/api/timetable/${tt._id}/entries`, entry());
  const res = await hod.post(`/api/timetable/${tt._id}/approve`);
  assert.equal(res.body.data.generated.linked, 1);
  const todays = await M.ClassSession.find({ date: today, subject: ctx.subjects.ds._id });
  assert.equal(todays.length, 1);
  assert.equal(todays[0].status, 'submitted', 'existing attendance is untouched');
  assert.ok(todays[0].timetableEntry);
  assert.equal(await M.Attendance.countDocuments({ classSession: todays[0]._id }), 3);
});

test("faculty see today's classes with room, status, enrolment and can start attendance in one step", async () => {
  await reset();
  const tt = await draft();
  await hod.post(`/api/timetable/${tt._id}/entries`, entry());
  await hod.post(`/api/timetable/${tt._id}/entries`, entry({ subjectId: String(ctx.subjects.os._id), startTime: '10:00', endTime: '11:00', room: 'R2' }));
  await hod.post(`/api/timetable/${tt._id}/approve`);

  const mine = await t1.get('/api/faculty/today');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.length, 1, 'only the classes of this teacher');
  const c = mine.body.data[0];
  assert.deepEqual([c.subject.name, c.room, c.startTime, c.endTime, c.status, c.studentCount], ['Data Structures', 'R1', '09:00', '10:00', 'scheduled', 3]);
  assert.equal((await t2.get('/api/faculty/today')).body.data[0].subject.name, 'Operating Systems');

  assert.equal((await t2.post(`/api/faculty/sessions/${c.id}/open`)).status, 403, "cannot open someone else's class");
  const opened = await t1.post(`/api/faculty/sessions/${c.id}/open`);
  assert.equal(opened.body.data.status, 'open');
  assert.equal((await t1.post(`/api/faculty/sessions/${c.id}/open`)).status, 200, 'idempotent');

  // mark attendance on the generated session through the normal endpoint: it becomes "submitted"
  const detail = await t1.get(`/api/faculty/attendance/sessions/${c.id}`);
  assert.equal(detail.body.data.students.length, 3);
  const submit = await t1.put(`/api/faculty/attendance/sessions/${c.id}`, {
    date: today, slot: c.slot, records: detail.body.data.students.map(s => ({ studentId: s.id, status: 'P' }))
  });
  assert.equal(submit.status, 200);
  const after = (await t1.get('/api/faculty/today')).body.data[0];
  assert.equal(after.status, 'submitted');
  assert.deepEqual(after.attendance, { present: 3, absent: 0 });
  // the same slot cannot be created a second time through the ad hoc endpoint
  const dup = await t1.put('/api/faculty/attendance/sessions', { subjectId: String(ctx.subjects.ds._id), date: today, slot: c.slot, expectNew: true, records: detail.body.data.students.map(s => ({ studentId: s.id, status: 'A' })) });
  assert.equal(dup.status, 409);
  assert.equal(await M.ClassSession.countDocuments({ subject: ctx.subjects.ds._id, date: today }), 1);

  // administrators can look at a colleague's day
  assert.equal((await hod.get(`/api/faculty/today?teacherId=${ctx.teacher2._id}`)).body.data.length, 1);
  assert.equal((await t1.get(`/api/faculty/today?teacherId=${ctx.teacher2._id}`)).status, 403);
});

test('a changed timetable keeps history: new version archives the old one and cancels only unmarked future classes', async () => {
  await reset();
  const v1 = await draft();
  await hod.post(`/api/timetable/${v1._id}/entries`, entry());
  await hod.post(`/api/timetable/${v1._id}/approve`);
  const sessions = await M.ClassSession.find({}).sort({ date: 1 });
  const first = sessions[0];
  await M.Attendance.create({ college: ctx.college._id, classSession: first._id, student: ctx.students[0].profile._id, subject: first.subject, section: first.section, date: first.date, status: 'P' });
  await M.ClassSession.updateOne({ _id: first._id }, { $set: { status: 'submitted' } });

  const newFrom = addDays(today, 1);
  const v2 = (await hod.post('/api/timetable', { sectionId: String(ctx.section._id), academicSessionId: String(ctx.academicSession._id), effectiveFrom: newFrom })).body.data;
  assert.equal(v2.version, 2);
  assert.equal((await M.TimetableEntry.countDocuments({ timetable: v2._id })), 1, 'entries are copied into the new draft');
  const copied = await M.TimetableEntry.findOne({ timetable: v2._id });
  await hod.del(`/api/timetable/${v2._id}/entries/${copied._id}`);
  await hod.post(`/api/timetable/${v2._id}/entries`, entry({ startTime: '11:00', endTime: '12:00', room: 'R5' }));
  const approved = await hod.post(`/api/timetable/${v2._id}/approve`);
  assert.equal(approved.status, 200);

  const old = await M.Timetable.findById(v1._id);
  assert.equal(old.status, 'archived');
  assert.equal(old.effectiveTo, addDays(newFrom, -1));
  const all = await M.ClassSession.find({}).lean();
  assert.ok(all.every(s => s.date < newFrom || s.startTime !== '09:00' || s.status === 'cancelled'), 'future classes of the old version are cancelled, not deleted');
  assert.ok(all.some(s => s.status === 'cancelled' && s.cancelReason === 'timetable_changed'));
  assert.ok(all.some(s => s.startTime === '11:00' && s.status === 'scheduled'), 'new version sessions exist');
  assert.equal((await M.ClassSession.findById(first._id)).status, 'submitted', 'a class with attendance is never touched');
  assert.equal(await M.Attendance.countDocuments({ classSession: first._id }), 1);
});

test('unmarked classes are detected once, respect the grace period, ignore future/cancelled/ad hoc classes', async () => {
  await reset();
  const tt = await draft();
  await hod.post(`/api/timetable/${tt._id}/entries`, entry({ startTime: '09:00', endTime: '10:00' }));
  await hod.post(`/api/timetable/${tt._id}/entries`, entry({ subjectId: String(ctx.subjects.os._id), startTime: '10:00', endTime: '11:00', room: 'R2' }));
  await hod.post(`/api/timetable/${tt._id}/approve`);
  const college = await freshCollege();

  assert.equal(await lifecycle.detectUnmarked(college, at(today, '09:30')), 0, 'class has not ended');
  assert.equal(await lifecycle.detectUnmarked(college, at(today, '10:20')), 0, 'inside the 30 minute grace period');
  assert.equal(await lifecycle.detectUnmarked(college, at(today, '10:45')), 1, 'DS ended 10:00, grace over');
  assert.equal(await lifecycle.detectUnmarked(college, at(today, '10:46')), 0, 'already flagged: not flagged again');

  const ds = await M.ClassSession.findOne({ date: today, startTime: '09:00' });
  assert.equal(ds.status, 'unmarked');
  assert.equal(await M.Notification.countDocuments({ type: 'unmarked_class' }), 2, 'administrator + teacher, once each');
  await lifecycle.detectUnmarked(college, at(today, '12:00'));
  assert.equal(await M.Notification.countDocuments({ type: 'unmarked_class', 'data.sessionId': String(ds._id) }), 2, 'no duplicate alert for the same incident');

  const future = await M.ClassSession.findOne({ date: { $gt: today } });
  if (future) assert.equal(future.status, 'scheduled', 'future classes are never flagged');

  // cancelled classes are not unmarked
  const os = await M.ClassSession.findOne({ date: today, startTime: '10:00' });
  await t2.post(`/api/faculty/sessions/${os._id}/cancel`, { reason: 'Teacher on leave' });
  await lifecycle.detectUnmarked(college, at(today, '13:00'));
  assert.equal((await M.ClassSession.findById(os._id)).status, 'cancelled');

  // ad hoc sessions (no timetable) are never flagged
  const adhoc = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.os._id, section: ctx.section._id, date: addDays(today, -3), slot: '2:00 PM – 3:00 PM', status: 'scheduled', source: 'adhoc' });
  await lifecycle.detectUnmarked(college, at(today, '13:00'));
  assert.equal((await M.ClassSession.findById(adhoc._id)).status, 'scheduled');
});

test('unmarked incidents can be explained, closed or cancelled by the right people, with an audit trail', async () => {
  const ds = await M.ClassSession.findOne({ date: today, startTime: '09:00' });
  assert.equal(ds.status, 'unmarked');
  assert.equal((await t2.post(`/api/faculty/sessions/${ds._id}/resolve`, { action: 'explained', reason: 'not mine' })).status, 403);
  assert.equal((await t1.post(`/api/faculty/sessions/${ds._id}/resolve`, { action: 'bogus', reason: 'x' })).status, 400);

  const explained = await t1.post(`/api/faculty/sessions/${ds._id}/resolve`, { action: 'explained', reason: 'Projector failed, will mark tomorrow' });
  assert.equal(explained.body.data.resolution.action, 'explained');
  assert.equal(explained.body.data.status, 'unmarked', 'explaining does not erase the missing attendance');

  const list = await hod.get('/api/timetable/unmarked');
  assert.ok(list.body.data.some(s => String(s._id) === String(ds._id)));
  assert.equal((await t2.get('/api/timetable/unmarked')).body.data.some(s => String(s._id) === String(ds._id)), false, 'faculty only see their own');

  // late marking turns it into a normal submitted class
  const detail = await t1.get(`/api/faculty/attendance/sessions/${ds._id}`);
  const marked = await t1.put(`/api/faculty/attendance/sessions/${ds._id}`, { date: ds.date, slot: ds.slot, records: detail.body.data.students.map(s => ({ studentId: s.id, status: 'P' })) });
  assert.equal(marked.status, 200);
  const done = await M.ClassSession.findById(ds._id);
  assert.equal(done.status, 'submitted');
  assert.equal(done.unmarkedAt, null);
  assert.equal((await hod.post(`/api/timetable/sessions/${ds._id}/resolve`, { action: 'explained', reason: 'again' })).body.error.code, 'NOT_UNMARKED');

  const other = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.os._id, section: ctx.section._id, teacher: ctx.teacher2._id, date: addDays(today, -1), slot: '3:00 PM – 4:00 PM', startTime: '15:00', endTime: '16:00', status: 'unmarked', source: 'timetable' });
  const closed = await hod.post(`/api/timetable/sessions/${other._id}/resolve`, { action: 'completed_without_attendance', reason: 'Guest lecture, no roll call' });
  assert.equal(closed.body.data.status, 'completed_no_attendance');
  const actions = await M.AuditLog.distinct('action', { college: ctx.college._id });
  for (const a of ['session.unmarked_explained', 'session.unmarked_completed_without_attendance', 'session.cancelled']) assert.ok(actions.includes(a), a);
});

test('cancelled classes cannot be marked, and classes with attendance cannot be cancelled', async () => {
  await reset();
  const s = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.ds._id, section: ctx.section._id, teacher: ctx.teacher._id, date: today, slot: '9:00 AM – 10:00 AM', startTime: '09:00', endTime: '10:00', status: 'scheduled', source: 'timetable' });
  assert.equal((await t1.post(`/api/faculty/sessions/${s._id}/cancel`, { reason: 'Holiday' })).body.data.status, 'cancelled');
  const records = ctx.students.map(x => ({ studentId: String(x.profile._id), status: 'P' }));
  assert.equal((await t1.put(`/api/faculty/attendance/sessions/${s._id}`, { date: today, slot: s.slot, records })).body.error.code, 'SESSION_CANCELLED');
  assert.equal((await t1.put('/api/faculty/attendance/sessions', { subjectId: String(ctx.subjects.ds._id), date: today, slot: s.slot, records })).body.error.code, 'SESSION_CANCELLED');

  const s2 = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.os._id, section: ctx.section._id, teacher: ctx.teacher2._id, date: today, slot: '9:00 AM – 10:00 AM', status: 'submitted' });
  await M.Attendance.create({ college: ctx.college._id, classSession: s2._id, student: ctx.students[0].profile._id, subject: s2.subject, section: s2.section, date: today, status: 'P' });
  assert.equal((await t2.post(`/api/faculty/sessions/${s2._id}/cancel`, { reason: 'oops' })).body.error.code, 'HAS_ATTENDANCE');
});

test('department heads can only manage timetables of their own department', async () => {
  const access = require('../../src/services/accessService');
  await access.ensureBuiltInRoles(ctx.college._id);
  const d1 = (await hod.post('/api/admin/access/departments', { name: 'CSE', code: 'cse' })).body.data;
  const d2 = (await hod.post('/api/admin/access/departments', { name: 'MECH', code: 'me' })).body.data;
  await hod.put(`/api/admin/access/sections/${ctx.section._id}/department`, { departmentId: d1._id });
  const sec2 = await M.Section.create({ college: ctx.college._id, name: 'ME-A', nameKey: 'me-a', sem: 'Sem 3', semesterNumber: 3, department: d2._id });
  const role = await M.Role.findOne({ college: ctx.college._id, key: 'dept_head' });
  const created = await hod.post('/api/admin/access/staff', { name: 'Head CSE', email: 'headcse@tt1.edu', password: PASSWORD, roleIds: [String(role._id)], departmentIds: [d1._id] });
  assert.equal(created.status, 201);
  await M.User.updateOne({ email: 'headcse@tt1.edu' }, { $set: { mustChangePassword: false } });
  const head = await harness.login({ collegeCode: ctx.college.code, email: 'headcse@tt1.edu', password: PASSWORD });
  const own = await head.post('/api/timetable', { sectionId: String(ctx.section._id), academicSessionId: String(ctx.academicSession._id), effectiveFrom: today });
  assert.equal(own.status, 201);
  const foreign = await head.post('/api/timetable', { sectionId: String(sec2._id), academicSessionId: String(ctx.academicSession._id), effectiveFrom: today });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error.code, 'OUT_OF_SCOPE');
  const listed = await head.get('/api/timetable');
  assert.ok(listed.body.data.every(t => String(t.section._id) === String(ctx.section._id)));
});

test('the jobs generate sessions and flag unmarked classes (and are safe to run repeatedly)', async () => {
  await reset();
  const tt = await draft();
  await hod.post(`/api/timetable/${tt._id}/entries`, entry({ startTime: '00:10', endTime: '00:20' }));
  await hod.post(`/api/timetable/${tt._id}/approve`);
  await M.ClassSession.deleteMany({});
  const runner = require('../../src/jobs/runner');
  require('../../src/jobs');
  const first = await runner.runJob('generate-sessions');
  assert.equal(first.status, 'ok');
  assert.ok(first.stats.created >= 1);
  const second = await runner.runJob('generate-sessions');
  assert.equal(second.stats.created, 0);
  const flagged = await runner.runJob('detect-unmarked');
  assert.equal(flagged.status, 'ok');
});

test('students see their own class timetable and upcoming cancellations, never another section\'s', async () => {
  await reset();
  const tt = await draft();
  await hod.post(`/api/timetable/${tt._id}/entries`, entry({ startTime: '11:00', endTime: '12:00', room: 'R7' }));
  await hod.post(`/api/timetable/${tt._id}/approve`);
  await timetables.generate(ctx.college._id, today, addDays(today, 6));
  const s = await harness.login(creds(ctx.college, ctx.students[0].user));
  const before = (await s.get('/api/student/timetable')).body.data;
  assert.equal(before.week.length, 1);
  assert.deepEqual([before.week[0].subject, before.week[0].room, before.week[0].dayOfWeek], ['Data Structures', 'R7', dow]);
  assert.equal(before.week[0].teacher, 'Prof One');
  assert.ok(before.upcoming.length >= 1);

  const first = await M.ClassSession.findOne({ section: ctx.section._id, date: today });
  await hod.post(`/api/timetable/sessions/${first._id}/cancel`, { reason: 'Faculty on leave' });
  const after = (await s.get('/api/student/timetable')).body.data;
  const cancelled = after.upcoming.find(c => c.status === 'cancelled');
  assert.ok(cancelled && cancelled.cancelReason === 'Faculty on leave');

  // a student of another section sees nothing of this timetable
  const other = await M.Section.create({ college: ctx.college._id, name: 'Other', nameKey: 'other', sem: 'Sem 3', semesterNumber: 3, course: 'B.Tech', specialization: 'EE', mentor: ctx.teacher._id });
  const studentService = require('../../src/services/studentService');
  const o = await studentService.registerStudent(ctx.hod, ctx.college._id, { name: 'Elsewhere', email: 'else@tt1.edu', password: PASSWORD, rollNo: 'TT1900', sectionId: other._id });
  await M.User.updateOne({ _id: o.user._id }, { $set: { mustChangePassword: false } });
  const os = await harness.login({ collegeCode: ctx.college.code, email: 'else@tt1.edu', password: PASSWORD });
  const none = (await os.get('/api/student/timetable')).body.data;
  assert.deepEqual([none.week.length, none.upcoming.length], [0, 0]);
  assert.equal((await t1.get('/api/student/timetable')).status, 403);
});
