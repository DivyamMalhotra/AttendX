const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');
const { todayISO, addDays } = require('../../src/utils/dates');
const { TIME_SLOTS } = require('../../src/config/constants');

let ctx; let M; let hod; let teacher; let principal; let deptHead; let student; let sectionB; let deptA; let deptB;
const today = todayISO('Asia/Kolkata');
const id = x => String(x._id || x);

/** present/absent records for a student in a subject, one class per day going back from yesterday. */
let dayCursor = 1;
async function mark(profile, section, subject, present, absent) {
  for (let i = 0; i < present + absent; i += 1) {
    const date = addDays(today, -(dayCursor += 1));
    const session = await M.ClassSession.create({ college: ctx.college._id, subject: subject._id, section: section._id, date, slot: TIME_SLOTS[0] });
    await M.Attendance.create({ college: ctx.college._id, classSession: session._id, student: profile._id, subject: subject._id, section: section._id, date, status: i < present ? 'P' : 'A' });
  }
}

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'ANL1', students: 4 });
  deptA = await M.Department.create({ college: ctx.college._id, name: 'Computer Science', code: 'CSE' });
  deptB = await M.Department.create({ college: ctx.college._id, name: 'Mechanical', code: 'ME' });
  await M.Section.updateOne({ _id: ctx.section._id }, { $set: { department: deptA._id } });
  sectionB = await M.Section.create({ college: ctx.college._id, name: 'ME-A', nameKey: 'me-a', sem: 'Sem 3', semesterNumber: 3, course: 'B.Tech', specialization: 'ME', mentor: ctx.teacher._id, department: deptB._id });
  const subjB = await M.Subject.create({ college: ctx.college._id, section: sectionB._id, name: 'Thermodynamics', nameKey: 'thermodynamics', code: 'ME201', teacher: ctx.teacher._id });
  const studentService = require('../../src/services/studentService');
  const other = await studentService.registerStudent(ctx.hod, ctx.college._id, { name: 'Mech Student', email: 'mech@anl1.edu', password: 'Passw0rd1', rollNo: 'ME2026001', sectionId: sectionB._id });
  await M.User.updateOne({ _id: other.user._id }, { $set: { mustChangePassword: false } });

  // attendance: student 0 perfect, 1 at 50%, 2 at 20%, 3 none; the mechanical student at 100%
  await mark(ctx.students[0].profile, ctx.section, ctx.subjects.ds, 10, 0);
  await mark(ctx.students[1].profile, ctx.section, ctx.subjects.ds, 5, 5);
  await mark(ctx.students[2].profile, ctx.section, ctx.subjects.ds, 2, 8);
  await mark(other.profile, sectionB, subjB, 6, 0);

  hod = await harness.login(creds(ctx.college, ctx.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  student = await harness.login(creds(ctx.college, ctx.students[0].user));
  principal = await makeStaff({ harness, hod, M, ctx, roleKey: 'principal', email: 'principal@anl1.edu' });
  deptHead = await makeStaff({ harness, hod, M, ctx, roleKey: 'dept_head', email: 'depthead@anl1.edu', departmentIds: [id(deptA)] });
  ctx.otherSectionId = id(sectionB);
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('analytics need analytics.view; teachers and students are refused', async () => {
  assert.equal((await teacher.get('/api/admin/analytics/overview')).status, 403);
  assert.equal((await student.get('/api/admin/analytics/overview')).status, 403);
  assert.equal((await teacher.get('/api/admin/analytics/at-risk')).status, 403);
  assert.equal((await principal.get('/api/admin/analytics/overview')).status, 200);
  assert.equal((await hod.get('/api/admin/analytics/overview?sectionId=nope')).status, 400);
});

test('the college overview aggregates attendance correctly', async () => {
  const o = (await principal.get('/api/admin/analytics/overview')).body.data;
  assert.equal(o.scope, 'college');
  assert.equal(o.totals.students, 5);
  assert.equal(o.totals.sections, 2);
  assert.equal(o.attendance.noData, 1);
  assert.equal(o.attendance.belowThreshold, 2, 'the 50% and 20% students are below the 75% threshold');
  const dist = Object.fromEntries(o.attendance.distribution.map(d => [d.label, d.students]));
  assert.deepEqual(dist, { '<50': 1, '50-64': 1, '65-74': 0, '75-84': 0, '85+': 2 });
  const cs = o.attendance.bySection.find(s => s.section.startsWith('CS-B'));
  assert.equal(cs.average, 56.7, '(10+5+2) of (10+10+10) classes');   // 17/30
  assert.equal(cs.department, 'Computer Science');
  assert.deepEqual(o.departments.map(d => d.department).sort(), ['Computer Science', 'Mechanical']);
  assert.equal(o.departments.find(d => d.department === 'Mechanical').averageAttendance, 100);
  assert.equal(o.attendanceTrend.length, 8);
  assert.ok(o.attendanceTrend.some(w => w.presentRate !== null));
});

test('department-scoped roles see only their department and cannot reach another section', async () => {
  const o = (await deptHead.get('/api/admin/analytics/overview')).body.data;
  assert.equal(o.scope, 'department');
  assert.equal(o.totals.students, 4);
  assert.deepEqual(o.attendance.bySection.map(s => s.department), ['Computer Science']);
  assert.equal(o.facilities, null, 'institution-wide library and hostel figures are not shown to department users');
  assert.equal((await deptHead.get(`/api/admin/analytics/overview?sectionId=${ctx.otherSectionId}`)).status, 403);
  assert.equal((await deptHead.get(`/api/admin/analytics/overview?sectionId=${id(ctx.section)}`)).status, 200);
  const atRisk = (await deptHead.get('/api/admin/analytics/at-risk')).body.data;
  assert.ok(atRisk.length > 0 && atRisk.every(r => r.section.startsWith('CS-B')));
  const full = (await principal.get('/api/admin/analytics/overview')).body.data;
  assert.ok(full.facilities && full.facilities.library && full.facilities.hostel);
});

test('fee, leave and result blocks aggregate without exposing individuals', async () => {
  const structure = await hod.post('/api/admin/fees/structures', {
    course: 'B.Tech', specialization: 'CSE', academicSessionId: id(ctx.academicSession), semesterNumber: 3,
    components: [{ name: 'Tuition', kind: 'tuition', amountPaise: 1_000_000 }], dueDate: addDays(today, -3)
  });
  await hod.post('/api/admin/fees/assign', { structureId: structure.body.data.id || structure.body.data._id, sectionId: id(ctx.section) });
  const s0 = await harness.login(creds(ctx.college, ctx.students[0].user));
  const assignment = await M.FeeAssignment.findOne({ student: ctx.students[0].profile._id });
  const order = await s0.post('/api/fees/orders', { assignmentId: id(assignment), amountPaise: 400_000 });
  const sim = (await s0.post(`/api/fees/orders/${order.body.data.checkout.orderId}/simulate`, { outcome: 'success' })).body.data;
  await s0.post(`/api/fees/orders/${order.body.data.checkout.orderId}/verify`, { paymentId: sim.paymentId, signature: sim.signature });

  const types = (await hod.get('/api/admin/leave-types')).body.data;
  const { multipart, file } = require('../helpers/multipart');
  await multipart(s0, 'post', '/api/student/duty-leaves', { reason: 'Surgery details here', fromDate: addDays(today, -1), toDate: addDays(today, -1), leaveTypeId: id(types.find(t => t.key === 'medical')) }, [{ ...file(), field: 'document' }]);

  const o = (await principal.get('/api/admin/analytics/overview')).body.data;
  assert.equal(o.fees.totalPayablePaise, 4_000_000);
  assert.equal(o.fees.collectedPaise, 400_000);
  assert.equal(o.fees.outstandingPaise, 3_600_000);
  assert.deepEqual([o.fees.counts.partial, o.fees.counts.unpaid, o.fees.counts.overdue], [1, 3, 4]);
  assert.equal(o.fees.collectionRate, 10);
  assert.equal(o.fees.last30Days.reduce((t, d) => t + d.amountPaise, 0), 400_000);
  const med = o.leave.byType.find(t => t.type === 'Medical leave');
  assert.equal(med.pending, 1);
  const blob = JSON.stringify(o);
  assert.ok(!blob.includes('Surgery') && !blob.includes('Student 1'), 'aggregates carry no reasons or names');
  assert.equal(o.results.exams, 0);
});

test('the at-risk list flags students by configurable criteria and never carries sensitive detail', async () => {
  const rows = (await principal.get('/api/admin/analytics/at-risk')).body.data;
  const byRoll = Object.fromEntries(rows.map(r => [r.rollNo, r]));
  const codes = r => r.flags.map(f => f.code).sort();
  assert.deepEqual(codes(byRoll[ctx.students[2].profile.rollNo]), ['attendance', 'fees'], '20% attendance and overdue fees');
  assert.deepEqual(codes(byRoll[ctx.students[0].profile.rollNo]), ['fees'], 'good attendance, but a balance is overdue');
  assert.ok(!byRoll.ME2026001, 'the healthy mechanical student is not listed');
  assert.equal(rows[0].flags.length >= rows.at(-1).flags.length, true, 'most flags first');
  assert.ok(!JSON.stringify(rows).includes('Surgery'));

  await hod.patch('/api/admin/settings', { atRisk: { minFlags: 2, flagOverdueFees: false } });
  const strict = (await principal.get('/api/admin/analytics/at-risk')).body;
  assert.equal(strict.data.length, 0, 'with fees ignored nobody has two flags');
  await hod.patch('/api/admin/settings', { atRisk: { minFlags: 1, flagOverdueFees: false, attendanceBelow: 60 } });
  const att = (await principal.get('/api/admin/analytics/at-risk')).body.data;
  assert.deepEqual(att.map(r => r.rollNo).sort(), [ctx.students[1].profile.rollNo, ctx.students[2].profile.rollNo].sort());
  await hod.patch('/api/admin/settings', { atRisk: { minFlags: 1, flagOverdueFees: true, attendanceBelow: 75 } });
});

test('the at-risk export needs reports.export and neutralises spreadsheet formulas', async () => {
  await M.User.updateOne({ _id: ctx.students[2].user._id }, { $set: { name: '=HYPERLINK("http://evil.example","x")' } });
  assert.equal((await deptHead.get('/api/admin/analytics/at-risk?format=csv')).status, 200, 'dept heads hold reports.export');
  const plain = await makeStaff({ harness, hod, M, ctx, roleKey: 'mentor', email: 'mentor@anl1.edu' });
  assert.equal((await plain.get('/api/admin/analytics/at-risk?format=csv')).status, 403);
  const csv = await hod.get('/api/admin/analytics/at-risk?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  const text = csv.text;
  assert.ok(text.startsWith('Roll no,Name,Section'));
  assert.ok(text.includes(`'=HYPERLINK`), 'the formula is exported as text');
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(text), 'no cell starts with =');
});
