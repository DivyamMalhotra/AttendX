const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff, PASSWORD } = require('../helpers/fixtures');
const { ROLES, ROLE_TITLES, CONSOLE_ROLES } = require('../../src/config/constants');

let ctx; let other; let M; let admin; let adminB; let hod; let clerk; let examCell; let teacher; let student; let deptA; let deptB; let sectionB; let studentB;

before(async () => {
  const { models } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'PERM1', students: 2 });
  other = await seedCollege(M, { code: 'PERM2', students: 1 });
  admin = await harness.login(creds(ctx.college, ctx.hod));          // the seeded college head is the Administrator
  adminB = await harness.login(creds(other.college, other.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  student = await harness.login(creds(ctx.college, ctx.students[0].user));
  clerk = await makeStaff({ harness, hod: admin, M, ctx, roleKey: 'accounts_clerk', email: 'clerk@perm1.edu' });
  examCell = await makeStaff({ harness, hod: admin, M, ctx, roleKey: 'exam_cell', email: 'cell@perm1.edu' });

  // two departments: the HOD belongs to A and must never reach B
  deptA = (await admin.post('/api/admin/access/departments', { name: 'Computer Science', code: 'cse' })).body.data;
  deptB = (await admin.post('/api/admin/access/departments', { name: 'Mechanical', code: 'mech' })).body.data;
  await admin.put(`/api/admin/access/sections/${ctx.section._id}/department`, { departmentId: deptA._id });
  sectionB = await M.Section.create({ college: ctx.college._id, name: 'ME-A', nameKey: 'me-a', sem: 'Sem 3', semesterNumber: 3, department: deptB._id });
  studentB = await require('../../src/services/studentService').registerStudent(ctx.hod, ctx.college._id, { name: 'Mech Student', email: 'mech@perm1.edu', password: PASSWORD, rollNo: 'ME2026001', sectionId: sectionB._id });
  const made = await admin.post('/api/admin/access/staff', { name: 'HOD CSE', email: 'hodcse@perm1.edu', password: PASSWORD, role: 'hod', departmentIds: [deptA._id] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  await M.User.updateOne({ email: 'hodcse@perm1.edu' }, { $set: { mustChangePassword: false } });
  hod = await harness.login({ collegeCode: ctx.college.code, email: 'hodcse@perm1.edu', password: PASSWORD });
});
after(() => harness.stop());

const perms = async agent => (await agent.get('/api/auth/me')).body.data.user.permissions;

test('exactly seven roles exist; Mentor, Librarian, Hostel Warden and every other role cannot be stored or created', async () => {
  assert.deepEqual(Object.values(ROLES).sort(), ['accounts_clerk', 'admin', 'exam_cell', 'hod', 'parent', 'student', 'teacher']);
  assert.deepEqual(Object.values(ROLE_TITLES).sort(), ['Accounts Clerk', 'Administrator', 'Exam Cell', 'HOD', 'Parent', 'Student', 'Teacher']);
  for (const role of ['staff', 'mentor', 'librarian', 'hostel_warden', 'registrar', 'super_admin']) {
    await assert.rejects(M.User.create({ college: ctx.college._id, role, name: 'X', email: `${role}@perm1.edu`, passwordHash: 'x' }), /not a valid enum value/, role);
    assert.equal((await admin.post('/api/admin/access/staff', { name: 'X', email: `${role}2@perm1.edu`, password: PASSWORD, role })).status, 400, role);
  }
  // Administrator and Parent are not created through staff creation either (parents need a verified student link)
  for (const role of ['admin', 'parent', 'teacher', 'student']) assert.equal((await admin.post('/api/admin/access/staff', { name: 'X', email: `${role}3@perm1.edu`, password: PASSWORD, role })).status, 400, role);
  assert.equal((await admin.post('/api/admin/access/roles', { key: 'custom', name: 'Custom', permissions: ['fees.view'] })).status, 404, 'custom roles no longer exist');
});

test('each college has exactly one designated Administrator, enforced by the database', async () => {
  await assert.rejects(M.User.create({ college: ctx.college._id, role: 'admin', name: 'Second', email: 'second@perm1.edu', passwordHash: 'x' }), /E11000/);
  assert.equal(await M.User.countDocuments({ college: ctx.college._id, role: 'admin' }), 1);
  assert.equal(await M.User.countDocuments({ college: other.college._id, role: 'admin' }), 1, 'a second college has its own Administrator');
});

test('Administrator and HOD are different: the HOD has no configuration, system or account powers', async () => {
  const a = await perms(admin); const h = await perms(hod);
  for (const p of ['settings.manage', 'system.backup', 'system.jobs', 'audit.view', 'roles.manage', 'parents.manage', 'roster.manage', 'students.manage']) {
    assert.ok(a.includes(p), `admin ${p}`);
    assert.ok(!h.includes(p), `hod must not hold ${p}`);
  }
  for (const p of ['analytics.atRisk', 'mentorNotes.view', 'leave.reviewMedical']) assert.ok(!a.includes(p), `admin must not hold ${p}`);
  assert.ok(h.includes('analytics.atRisk') && h.includes('attendance.view'));
  for (const url of ['/api/admin/settings', '/api/admin/audit-log', '/api/admin/system/jobs', '/api/admin/access/staff', '/api/admin/mentoring/parents']) {
    assert.equal((await hod.get(url)).status, 403, `hod ${url}`);
  }
  assert.equal((await hod.patch('/api/admin/settings', { attendanceThreshold: 10 })).status, 403);
  assert.equal((await admin.get('/api/admin/settings')).status, 200);
});

test('attendance thresholds are set by the Administrator for their own college only and the HOD views use them', async () => {
  assert.equal((await admin.patch('/api/admin/settings', { attendanceThreshold: 70 })).status, 200);
  assert.equal((await M.College.findById(ctx.college._id)).settings.attendanceThreshold, 70);
  assert.notEqual((await M.College.findById(other.college._id)).settings.attendanceThreshold, 70, 'another college is untouched');
  assert.equal((await admin.patch('/api/admin/settings', { attendanceThreshold: 150 })).status, 400, 'values are validated');
  const report = await hod.get('/api/admin/attendance/report');
  assert.equal(report.status, 200);
  await admin.patch('/api/admin/settings', { attendanceThreshold: 75 });
});

test('a HOD only sees the department they were assigned (students, sections, exams, analytics, at-risk, exports)', async () => {
  const names = res => res.body.data.map(s => s.name || s.rollNo);
  const list = (await hod.get('/api/admin/students')).body.data.map(s => s.rollNo);
  assert.ok(list.length >= 2 && !list.includes('ME2026001'), 'no student of another department');
  assert.deepEqual((await admin.get('/api/admin/students?limit=100')).body.data.map(s => s.rollNo).includes('ME2026001'), true);
  assert.equal((await hod.get(`/api/admin/students?sectionId=${sectionB._id}`)).body.data.length, 0, 'asking for another section returns nothing');
  const secs = (await hod.get('/api/admin/sections')).body.data.map(s => s.name);
  assert.deepEqual(secs, ['CS-B']);
  assert.equal((await hod.get(`/api/admin/analytics/overview?sectionId=${sectionB._id}`)).status, 403);
  assert.equal((await hod.get('/api/admin/analytics/overview')).body.data.totals.students, 2);
  const atRisk = await hod.get('/api/admin/analytics/at-risk');
  assert.equal(atRisk.status, 200);
  assert.ok(atRisk.body.data.every(r => r.rollNo !== 'ME2026001'));
  const csv = (await hod.get('/api/admin/data/export/students')).text;
  assert.ok(csv.includes(ctx.students[0].profile.rollNo) && !csv.includes('ME2026001'), 'exports follow the department too');
  assert.equal((await hod.get(`/api/admin/attendance/report?sectionId=${sectionB._id}`)).body.data.length, 0);
  assert.equal((await hod.get('/api/admin/exams')).status, 200);
  void names;
});

test('a HOD with no department assigned sees nothing; the HOD cannot decide leave or run fees, marks upload or imports', async () => {
  const made = await admin.post('/api/admin/access/staff', { name: 'HOD none', email: 'hodnone@perm1.edu', password: PASSWORD, role: 'hod' });
  assert.equal(made.status, 201);
  await M.User.updateOne({ email: 'hodnone@perm1.edu' }, { $set: { mustChangePassword: false } });
  const none = await harness.login({ collegeCode: ctx.college.code, email: 'hodnone@perm1.edu', password: PASSWORD });
  assert.equal((await none.get('/api/admin/students')).status, 403);
  for (const agent of [hod]) {
    assert.equal((await agent.get('/api/duty-leaves/review')).status, 403);
    assert.equal((await agent.get('/api/admin/fees/assignments')).status, 403);
    assert.equal((await agent.get('/api/admin/data/imports')).status, 403);
    assert.equal((await agent.get('/api/admin/library/books')).status, 403);
    assert.equal((await agent.get('/api/admin/hostel/hostels')).status === 200, false);
  }
});

test('Administrator access is limited to their own college: another college\'s records are unreachable', async () => {
  const foreign = other.students[0].profile;
  assert.equal((await admin.patch(`/api/admin/students/${foreign._id}`, { phone: '9999999999' })).status, 404);
  assert.ok(!(await admin.get('/api/admin/students?limit=100')).body.data.some(s => s.id === String(foreign._id)));
  assert.ok(!(await admin.get('/api/admin/sections')).body.data.some(s => String(s._id) === String(other.section._id)));
  assert.equal((await admin.put(`/api/admin/access/sections/${other.section._id}/department`, { departmentId: deptA._id })).status === 200, false);
  assert.equal((await adminB.get(`/api/admin/students?sectionId=${ctx.section._id}`)).body.data.length, 0, 'the other Administrator cannot list this college class');
  const staffA = (await admin.get('/api/admin/access/staff')).body.data.map(s => s.email);
  assert.ok(!staffA.some(e => e.endsWith('@perm2.edu')));
  const audit = (await admin.get('/api/admin/audit-log')).body.data;
  assert.ok(audit.every(r => !r.college || String(r.college) === String(ctx.college._id)));
});

test('support roles hold fixed permissions; none of them touches attendance or administrator tools', async () => {
  for (const [agent, name] of [[clerk, 'clerk'], [examCell, 'exam cell']]) {
    const p = await perms(agent);
    assert.ok(!p.some(x => x.startsWith('attendance.')), `${name} has no attendance permission`);
    assert.ok(!p.some(x => ['roles.manage', 'system.backup', 'system.jobs', 'audit.view', 'settings.manage'].includes(x)), `${name} has no Administrator tools`);
  }
  assert.ok((await perms(clerk)).includes('fees.view') && !(await perms(clerk)).includes('marks.upload'));
  assert.ok((await perms(examCell)).includes('marks.upload') && !(await perms(examCell)).includes('fees.view'));
  assert.deepEqual(await perms(student), []);
  for (const agent of [clerk, examCell, teacher, student]) {
    for (const url of ['/api/admin/attendance/report', '/api/admin/attendance/alerts', '/api/admin/audit-log', '/api/admin/system/jobs', '/api/admin/settings']) assert.equal((await agent.get(url)).status, 403, url);
  }
  assert.equal((await clerk.get('/api/admin/fees/assignments')).status, 200);
  for (const agent of [examCell, teacher, student]) assert.equal((await agent.get('/api/admin/fees/assignments')).status, 403);
  assert.equal((await examCell.get('/api/admin/exams')).status, 200);
  assert.equal((await clerk.get('/api/admin/exams')).status, 403);
  assert.equal((await admin.get('/api/admin/library/books')).status, 200, 'the library desk is the Administrator\'s');
  for (const agent of [clerk, examCell, teacher, student, hod]) assert.equal((await agent.get('/api/admin/library/books')).status, 403);
});

test('console roles list matches the seven-role model', () => {
  assert.deepEqual([...CONSOLE_ROLES].sort(), ['accounts_clerk', 'admin', 'exam_cell', 'hod']);
});

test('staff accounts start with a temporary password that must be changed; nobody changes their own access; deactivation is immediate', async () => {
  const res = await admin.post('/api/admin/access/staff', { name: 'New Clerk', email: 'newclerk@perm1.edu', password: PASSWORD, role: 'accounts_clerk' });
  assert.equal(res.status, 201);
  const u = await M.User.findOne({ email: 'newclerk@perm1.edu' }).select('+passwordHash');
  assert.deepEqual([u.role, u.mustChangePassword, u.passwordHash === PASSWORD], ['accounts_clerk', true, false]);
  assert.equal((await (await harness.login({ collegeCode: ctx.college.code, email: 'newclerk@perm1.edu', password: PASSWORD })).get('/api/admin/fees/assignments')).status, 403, 'blocked until the password is changed');

  const staff = (await admin.get('/api/admin/access/staff')).body.data;
  const me = staff.find(s => s.email === 'clerk@perm1.edu');
  await admin.patch(`/api/admin/access/staff/${me.id}`, { active: false });
  assert.equal((await clerk.get('/api/auth/me')).status, 401);
  await admin.patch(`/api/admin/access/staff/${me.id}`, { active: true });
  assert.ok(await M.AuditLog.findOne({ action: 'staff.created' }));
});

test('mass assignment cannot smuggle a role into a user, and a forged role claim gains nothing', async () => {
  assert.equal((await student.patch('/api/student/profile', { phone: '123456', role: 'admin', customRoles: [String(ctx.college._id)] })).status, 200);
  const u = await M.User.findById(ctx.students[0].user._id);
  assert.deepEqual([u.role, u.customRoles.length], ['student', 0]);
  for (const url of ['/api/admin/access/staff', '/api/admin/settings']) assert.equal((await student.get(url)).status, 403);
  assert.equal((await student.get('/api/admin/students', { headers: { 'x-role': 'admin' } })).status, 403);
});

void studentB;
