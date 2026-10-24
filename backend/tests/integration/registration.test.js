const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');

let ctx; let M; let hod; let student;

const body = (over = {}) => ({
  name: 'New Student', email: `new${Math.random().toString(36).slice(2, 8)}@x.edu`, password: 'Passw0rd1',
  rollNo: 'CSE2026001', sectionId: String(ctx.section._id), ...over
});
const register = (over, agent = hod) => agent.post('/api/admin/students', body(over));

before(async () => {
  const { models } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'REG1', students: 2 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  student = await harness.login(creds(ctx.college, ctx.students[0].user));
});
after(() => harness.stop());

test('a valid student with a unique roll number is registered in normalized form', async () => {
  const res = await register({ rollNo: ' cse2026001 ' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.rollNo, 'CSE2026001');
  assert.equal(res.body.data.active, true);
});

test('duplicate roll numbers are rejected whatever the casing or spacing (original bug)', async () => {
  for (const variant of ['CSE2026001', 'cse2026001', '  CSE2026001  ', 'cse 2026 001']) {
    const res = await register({ rollNo: variant });
    assert.equal(res.status, 409, variant);
    assert.equal(res.body.error.code, 'ROLL_NUMBER_EXISTS');
  }
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: 'CSE2026001' }), 1);
});

test('a rejected duplicate leaves no orphan login account behind', async () => {
  const email = 'orphan@x.edu';
  await register({ rollNo: 'CSE2026001', email });
  assert.equal(await M.User.countDocuments({ email }), 0);
});

test('concurrent registrations with the same roll number create exactly one student', async () => {
  const users = await M.User.countDocuments();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => register({ rollNo: i % 2 ? 'race-001' : ' RACE-001', email: `race${i}@x.edu` })));
  assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => r.status)));
  assert.ok(results.filter(r => r.status !== 201).every(r => r.status === 409));
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: 'RACE-001' }), 1);
  assert.equal(await M.User.countDocuments(), users + 1, 'losing attempts removed their user rows');
});

test('the database enforces uniqueness even if the application layer is bypassed', async () => {
  const existing = ctx.students[0].profile;
  const other = await M.User.create({ college: ctx.college._id, role: 'student', name: 'Raw', email: 'raw@x.edu', passwordHash: 'x' });
  await assert.rejects(M.StudentProfile.create({ college: ctx.college._id, user: other._id, section: ctx.section._id, rollNo: ` ${existing.rollNo.toLowerCase()} ` }), /E11000/);
});

test('invalid roll number formats and fields are rejected by the backend', async () => {
  assert.equal((await register({ rollNo: 'A' })).body.error.code, 'INVALID_ROLL_NUMBER');
  assert.equal((await register({ rollNo: 'AB$12' })).body.error.code, 'INVALID_ROLL_NUMBER');
  assert.equal((await register({ email: 'not-an-email' })).status, 400);
  assert.equal((await register({ password: 'short' })).status, 400);
  assert.equal((await register({ sectionId: '64b7f0f0f0f0f0f0f0f0f0f0' })).body.error.code, 'SECTION_NOT_FOUND');
});

test('the same roll number may exist in a different college', async () => {
  const other = await seedCollege(M, { code: 'REG2', students: 1 });
  const otherHod = await harness.login(creds(other.college, other.hod));
  const res = await otherHod.post('/api/admin/students', body({ rollNo: 'CSE2026001', sectionId: String(other.section._id) }));
  assert.equal(res.status, 201);
});

test('students cannot change their roll number or other protected fields', async () => {
  const before = await M.StudentProfile.findById(ctx.students[0].profile._id);
  const res = await student.patch('/api/student/profile', { phone: '9876543210', rollNo: 'HACK999', section: String(ctx.section._id), college: 'x', active: false });
  assert.equal(res.status, 200);
  const after = await M.StudentProfile.findById(before._id);
  assert.equal(after.rollNo, before.rollNo);
  assert.equal(after.phone, '9876543210');
  assert.equal(after.active, true);
  assert.equal((await student.patch('/api/admin/students/' + before._id, { rollNo: 'HACK999' })).status, 403);
});

test('the administrator can change a roll number; it is validated, de-duplicated and audited', async () => {
  const target = ctx.students[1].profile;
  assert.equal((await hod.patch(`/api/admin/students/${target._id}`, { rollNo: 'CSE2026001' })).status, 409);
  const ok = await hod.patch(`/api/admin/students/${target._id}`, { rollNo: ' reg-777 ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.rollNo, 'REG-777');
  assert.ok(await M.AuditLog.exists({ action: 'student.roll_number_changed', entityId: String(target._id) }));
});

test('attendance and fees reference the internal student id, so a roll number change keeps history intact', async () => {
  const target = ctx.students[1].profile;
  const session = await M.ClassSession.create({ college: ctx.college._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date: '2026-01-05', slot: '9:00 AM – 10:00 AM' });
  await M.Attendance.create({ college: ctx.college._id, classSession: session._id, student: target._id, subject: ctx.subjects.ds._id, section: ctx.section._id, date: '2026-01-05', status: 'P' });
  await hod.patch(`/api/admin/students/${target._id}`, { rollNo: 'REG-778' });
  assert.equal(await M.Attendance.countDocuments({ student: target._id }), 1);
});

test('deactivating a student keeps their records and blocks sign-in', async () => {
  const target = ctx.students[0];
  assert.equal((await hod.patch(`/api/admin/students/${target.profile._id}`, { active: false })).status, 200);
  const login = await harness.login(creds(ctx.college, target.user));
  assert.equal(login.res.status, 401);
  assert.ok(await M.StudentProfile.exists({ _id: target.profile._id }));
  const list = await hod.get('/api/admin/students?includeInactive=true');
  assert.ok(list.body.data.some(s => s.rollNo === target.profile.rollNo && s.active === false));
});
