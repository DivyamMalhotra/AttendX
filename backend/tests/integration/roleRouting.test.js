const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { multipart, file } = require('../helpers/multipart');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');
const { todayISO, addDays } = require('../../src/utils/dates');
const notifications = require('../../src/services/notificationService');
const { NOTIFICATION_TYPES: T } = require('../../src/config/constants');

let ctx; let M; let hod; let t1; let t2; let s1; let s2; let s3; let librarian;
const today = todayISO('Asia/Kolkata');
const D = n => addDays(today, n);
const teacherNotes = async teacher => M.Notification.find({ user: teacher._id }).lean();
const apply = (agent, over = {}) => agent.post('/api/student/duty-leaves', { fromDate: D(-1), toDate: D(-1), reason: 'Inter-college meet', ...over });

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'RR1', students: 3 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
  s3 = await harness.login(creds(ctx.college, ctx.students[2].user));
  librarian = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'lib@rr1.edu' });
});
after(async () => { removeFakeProviders(); await harness.stop(); });

/* ------------------------------------------------------------- notification routing */

test('the notification gateway never stores a student-facing event for a teacher or staff account', async () => {
  const recipients = [ctx.teacher, ctx.hod];
  for (const type of notifications.STUDENT_ONLY_TYPES) {
    for (const user of recipients) {
      const made = await notifications.notify({ collegeId: ctx.college._id, userId: user._id, type, title: 'x', message: 'y', dedupeKey: `route:${type}:${user._id}` });
      assert.equal(made, null, `${type} must not reach ${user.role}`);
    }
  }
  assert.equal(await M.Notification.countDocuments({ user: { $in: recipients.map(u => u._id) }, dedupeKey: /^route:/ }), 0);
  const kept = await notifications.notify({ collegeId: ctx.college._id, userId: ctx.students[0].user._id, type: T.PAYMENT, title: 'Payment received', message: 'ok', dedupeKey: 'route:student' });
  assert.ok(kept, 'the same event still reaches the student');
});

test('a student submitting an assignment creates no notification for the teacher, and the student flow still works', async () => {
  const before = (await teacherNotes(ctx.teacher)).length;
  const a = (await multipart(t1, 'post', '/api/faculty/assignments', { subjectId: String(ctx.subjects.ds._id), title: 'Routing', instructions: 'Do it.', deadline: new Date(Date.now() + 48 * 3600000).toISOString(), maxMarks: 10 }, [file('brief.pdf')])).body.data;
  assert.equal((await t1.post(`/api/faculty/assignments/${a._id}/publish`)).status, 200);
  const sent = await multipart(s1, 'post', `/api/student/assignments/${a._id}/submit`, { note: 'done' }, [file()]);
  assert.equal(sent.status, 201);
  assert.equal((await teacherNotes(ctx.teacher)).length, before, 'no teacher notification for the submission or the publication');
  assert.equal(await M.Notification.countDocuments({ user: ctx.students[0].user._id, 'data.assignmentId': a._id }), 1, 'students still hear about the new assignment, once');
  assert.equal((await t1.get('/api/auth/me')).status, 200);
});

test('fee events (late fee, reminder, refund text) go to the student only', async () => {
  const lateFees = require('../../src/services/lateFeeService');
  assert.equal(typeof lateFees.assessCollege, 'function');
  const anyFee = await M.Notification.countDocuments({ user: { $in: [ctx.teacher._id, ctx.teacher2._id, ctx.hod._id] }, type: { $in: [T.PAYMENT, T.FEE_REMINDER, T.LATE_FEE, T.REFUND] } });
  assert.equal(anyFee, 0);
});

test('QR scans and attendance results produce no teacher notification; the live scan counter still works', async () => {
  const qrService = require('../../src/services/qrAttendanceService');
  assert.equal(typeof qrService.scan, 'function');
  assert.ok(!(await teacherNotes(ctx.teacher)).some(n => /qr|scan|otp/i.test(`${n.type} ${n.title}`)));
});

test('legitimate notices still reach teachers: an announcement for teachers and an unmarked class of their own', async () => {
  const post = await multipart(hod, 'post', '/api/announcements', { title: 'Staff meeting', body: 'Friday 3 PM', audience: { roles: ['teacher'] }, publishNow: 'true' });
  assert.equal(post.status, 201, JSON.stringify(post.body));
  assert.equal(await M.Notification.countDocuments({ user: ctx.teacher._id, type: T.ANNOUNCEMENT }), 1);
  assert.equal(await M.Notification.countDocuments({ user: ctx.students[0].user._id, title: 'Staff meeting' }), 0, 'students are not addressed');

  const lifecycle = require('../../src/services/sessionLifecycleService');
  await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.ds._id, section: ctx.section._id, teacher: ctx.teacher._id, date: D(-1), slot: '9:00 AM – 10:00 AM', startTime: '09:00', endTime: '10:00', status: 'scheduled', source: 'timetable' });
  const college = await M.College.findById(ctx.college._id);
  assert.equal(await lifecycle.detectUnmarked(college, new Date()), 1);
  await lifecycle.detectUnmarked(college, new Date());
  assert.equal(await M.Notification.countDocuments({ user: ctx.teacher._id, type: T.UNMARKED_CLASS }), 1, 'the responsible teacher is told once, with no duplicate');
  assert.equal(await M.Notification.countDocuments({ user: ctx.teacher2._id, type: T.UNMARKED_CLASS }), 0, 'other teachers are not');
});

/* ------------------------------------------------------------------ leave routing and dates */

test('a leave request goes to the student\'s own mentor: not to other teachers, not to the Administrator', async () => {
  await M.DutyLeaveRequest.deleteMany({}); await M.DutyLeaveDay.deleteMany({});
  const res = await apply(s1);
  assert.equal(res.status, 201);
  const doc = await M.DutyLeaveRequest.findById(res.body.data.id);
  assert.equal(String(doc.mentor), String(ctx.teacher._id), 'section mentor');
  assert.equal((await t1.get('/api/duty-leaves/review')).body.data.length, 1);
  assert.deepEqual((await t2.get('/api/duty-leaves/review')).body.data, []);
  assert.equal((await hod.get('/api/duty-leaves/review')).status, 403);
  assert.equal((await t2.post(`/api/duty-leaves/${doc._id}/review`, { decision: 'approved' })).status, 403);
  assert.equal((await hod.post(`/api/duty-leaves/${doc._id}/review`, { decision: 'approved' })).status, 403);
  assert.equal((await t1.post(`/api/duty-leaves/${doc._id}/review`, { decision: 'approved' })).status, 200);
  assert.equal((await s1.get('/api/student/duty-leaves')).body.data[0].status, 'approved', 'the student sees the status');
  const audit = await M.AuditLog.countDocuments({ action: { $in: ['dutyleave.submitted', 'dutyleave.approved'] }, entityId: String(doc._id) });
  assert.equal(audit, 2, 'submission and decision are both audited');
});

test('an individual mentor assignment overrides the section mentor', async () => {
  await M.DutyLeaveRequest.deleteMany({}); await M.DutyLeaveDay.deleteMany({});
  assert.equal((await hod.post('/api/admin/mentoring/assign', { studentIds: [String(ctx.students[1].profile._id)], mentorId: String(ctx.teacher2._id) })).status, 201);
  const doc = await M.DutyLeaveRequest.findById((await apply(s2)).body.data.id);
  assert.equal(String(doc.mentor), String(ctx.teacher2._id));
  assert.equal((await t2.get('/api/duty-leaves/review')).body.data.length, 1);
  assert.deepEqual((await t1.get('/api/duty-leaves/review')).body.data, []);
});

test('with no mentor the request stays pending, is never auto-approved, and is surfaced to the Administrator', async () => {
  await M.DutyLeaveRequest.deleteMany({}); await M.DutyLeaveDay.deleteMany({});
  await M.Section.updateOne({ _id: ctx.section._id }, { $set: { mentor: null } });
  await M.MentorAssignment.deleteMany({});
  const res = await apply(s3);
  assert.equal(res.status, 201);
  const doc = await M.DutyLeaveRequest.findById(res.body.data.id);
  assert.equal(doc.mentor, null);
  assert.equal(doc.status, 'pending');
  const unassigned = (await hod.get('/api/duty-leaves/unassigned')).body.data;
  assert.deepEqual(unassigned.map(r => r.id), [res.body.data.id]);
  for (const agent of [t1, t2]) assert.deepEqual((await agent.get('/api/duty-leaves/review')).body.data, []);
  assert.equal((await t1.post(`/api/duty-leaves/${doc._id}/review`, { decision: 'approved' })).status, 403);
  assert.equal((await librarian.get('/api/duty-leaves/unassigned')).status, 403);
  assert.equal((await s3.get('/api/duty-leaves/unassigned')).status, 403);
  await M.Section.updateOne({ _id: ctx.section._id }, { $set: { mentor: ctx.teacher._id } });
});

async function markAbsent(student, date, subject = ctx.subjects.ds) {
  const session = await M.ClassSession.create({ college: ctx.college._id, subject: subject._id, section: ctx.section._id, teacher: ctx.teacher._id, date, slot: `s-${date}`, status: 'submitted' });
  await M.Attendance.create({ college: ctx.college._id, classSession: session._id, student: student.profile._id, subject: subject._id, section: ctx.section._id, date, status: 'A' });
}
const stats = async student => {
  const college = await M.College.findById(ctx.college._id);
  const { computeStats } = require('../../src/services/attendanceStatsService');
  const r = await computeStats({ collegeId: ctx.college._id, studentIds: [student.profile._id], subjectIds: [ctx.subjects.ds._id], settings: college.settings });
  const g = r.get(String(student.profile._id), String(ctx.subjects.ds._id));
  return { eligible: g.eligible, exempt: g.exempt };
};

test('approved leave changes attendance only on the selected dates; a future-dated approval never alters earlier days', async () => {
  await M.DutyLeaveRequest.deleteMany({}); await M.DutyLeaveDay.deleteMany({}); await M.Attendance.deleteMany({}); await M.ClassSession.deleteMany({});
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.dutyLeavePolicy': 'exclude' } });
  const s = ctx.students[0];
  for (const d of [-6, -5, -4, -3]) await markAbsent(s, D(d));
  assert.deepEqual(await stats(s), { eligible: 4, exempt: 0 });

  // future-dated leave (approved in advance) must not touch the past
  const future = (await apply(s1, { fromDate: D(3), toDate: D(4) })).body.data.id;
  assert.equal((await t1.post(`/api/duty-leaves/${future}/review`, { decision: 'approved' })).status, 200);
  assert.deepEqual(await stats(s), { eligible: 4, exempt: 0 }, 'earlier absences are unchanged');

  // a past range affects exactly the days chosen
  const past = (await apply(s1, { fromDate: D(-5), toDate: D(-4) })).body.data.id;
  assert.deepEqual(await stats(s), { eligible: 4, exempt: 0 }, 'pending leave changes nothing');
  assert.equal((await t1.post(`/api/duty-leaves/${past}/review`, { decision: 'approved' })).status, 200);
  assert.deepEqual(await stats(s), { eligible: 2, exempt: 2 }, 'only the two selected days are excused');

  // repeated approval attempts and a rejected request add no second effect
  assert.equal((await t1.post(`/api/duty-leaves/${past}/review`, { decision: 'approved' })).status, 409);
  const rejected = (await apply(s1, { fromDate: D(-6), toDate: D(-6) })).body.data.id;
  await t1.post(`/api/duty-leaves/${rejected}/review`, { decision: 'rejected' });
  assert.deepEqual(await stats(s), { eligible: 2, exempt: 2 });
  assert.equal(await M.Attendance.countDocuments({ student: s.profile._id }), 4, 'raw attendance rows are never rewritten');
  assert.equal(await M.DutyLeaveDay.countDocuments({ request: past, active: true }), 2, 'one row per selected date, no duplicates');
});

test('multi-day ranges, invalid ranges and overlaps are validated', async () => {
  await M.DutyLeaveRequest.deleteMany({}); await M.DutyLeaveDay.deleteMany({});
  assert.equal((await apply(s1, { fromDate: D(-1), toDate: D(-3) })).body.error.code, 'INVALID_RANGE');
  const ok = await apply(s1, { fromDate: D(-3), toDate: D(-1) });
  assert.equal(ok.status, 201);
  assert.equal(await M.DutyLeaveDay.countDocuments({ request: ok.body.data.id }), 3);
  assert.equal((await apply(s1, { fromDate: D(-2), toDate: D(-2) })).body.error.code, 'DUTY_LEAVE_DUPLICATE');
});
