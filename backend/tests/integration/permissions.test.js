const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, PASSWORD } = require('../helpers/fixtures');

let ctx; let M; let hod; let access; let other;

const roleBody = (over = {}) => ({ key: 'fee_viewer', name: 'Fee viewer', permissions: ['fees.view', 'payments.view'], ...over });

async function makeStaff(roleKeys, email, departmentIds = []) {
  const roles = await M.Role.find({ college: ctx.college._id, key: { $in: roleKeys } });
  const res = await hod.post('/api/admin/access/staff', { name: 'Staff Person', email, password: PASSWORD, roleIds: roles.map(r => String(r._id)), departmentIds });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await M.User.updateOne({ email, college: ctx.college._id }, { $set: { mustChangePassword: false } });
  return harness.login({ collegeCode: ctx.college.code, email, password: PASSWORD });
}

before(async () => {
  const { models } = await harness.start();
  M = models;
  access = require('../../src/services/accessService');
  ctx = await seedCollege(M, { code: 'PERM1', students: 2 });
  other = await seedCollege(M, { code: 'PERM2', students: 1 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  await access.ensureBuiltInRoles(ctx.college._id);
});
after(() => harness.stop());

test('HOD holds every permission; teachers and students hold none of the admin ones', async () => {
  const me = await hod.get('/api/auth/me');
  assert.ok(me.body.data.user.permissions.includes('roles.manage'));
  assert.ok(me.body.data.user.permissions.length > 30);
  const teacher = await harness.login(creds(ctx.college, ctx.teacher));
  assert.equal((await teacher.get('/api/admin/access/roles')).status, 403);
  assert.equal((await teacher.get('/api/admin/fees/structures')).status, 403);
  const t = await teacher.get('/api/auth/me');
  assert.ok(t.body.data.user.permissions.includes('attendance.mark'));
  assert.ok(!t.body.data.user.permissions.includes('fees.configure'));
  const student = await harness.login(creds(ctx.college, ctx.students[0].user));
  assert.equal((await student.get('/api/admin/access/roles')).status, 403);
  assert.deepEqual((await student.get('/api/auth/me')).body.data.user.permissions, []);
});

test('built-in role templates exist and are not editable', async () => {
  const roles = (await hod.get('/api/admin/access/roles')).body.data;
  for (const key of ['principal', 'dept_head', 'accounts_clerk', 'exam_cell', 'librarian', 'hostel_warden', 'mentor', 'counsellor']) {
    assert.ok(roles.find(r => r.key === key && r.builtIn), key);
  }
  const clerk = roles.find(r => r.key === 'accounts_clerk');
  assert.equal((await hod.patch(`/api/admin/access/roles/${clerk._id}`, { permissions: ['fees.view'] })).body.error.code, 'BUILTIN_ROLE');
});

test('an administrator creates a custom role and staff user; only the granted permissions work', async () => {
  const created = await hod.post('/api/admin/access/roles', roleBody());
  assert.equal(created.status, 201);
  assert.equal((await hod.post('/api/admin/access/roles', roleBody())).status, 409);
  assert.equal((await hod.post('/api/admin/access/roles', roleBody({ key: 'bad', permissions: ['not.a.permission'] }))).body.error.code, 'UNKNOWN_PERMISSION');

  const staff = await makeStaff(['fee_viewer'], 'clerk@perm1.edu');
  assert.equal((await staff.get('/api/admin/fees/assignments')).status, 200);
  assert.equal((await staff.get('/api/admin/fees/transactions')).status, 200);
  assert.equal((await staff.get('/api/admin/fees/structures')).status, 200, 'fees.view may list structures');
  assert.equal((await staff.post('/api/admin/fees/structures', {})).status, 403, 'no fees.configure');
  assert.equal((await staff.get('/api/admin/students')).status, 403);
  assert.equal((await staff.get('/api/admin/audit-log')).status, 403);
  assert.equal((await staff.get('/api/faculty/subjects')).status, 403, 'staff are not faculty');
  assert.equal((await staff.get('/api/student/dashboard')).status, 403);
});

test('privilege escalation is blocked: you cannot grant what you do not hold, edit your own roles, or edit built-ins', async () => {
  const staff = await makeStaff(['fee_viewer'], 'manager@perm1.edu');
  // a staff user who may manage roles but only holds fee permissions
  const custom = await hod.post('/api/admin/access/roles', roleBody({ key: 'role_admin', name: 'Role admin', permissions: ['roles.manage', 'fees.view'] }));
  const mgr = await makeStaff(['role_admin'], 'roleadmin@perm1.edu');
  const grabAll = await mgr.post('/api/admin/access/roles', roleBody({ key: 'super', name: 'Super', permissions: ['results.publish', 'fees.view'] }));
  assert.equal(grabAll.status, 403);
  assert.equal(grabAll.body.error.code, 'PERMISSION_ESCALATION');
  const ok = await mgr.post('/api/admin/access/roles', roleBody({ key: 'viewer2', name: 'Viewer 2', permissions: ['fees.view'] }));
  assert.equal(ok.status, 201);

  // cannot give the HOD-only powers to a user through an existing powerful role
  const clerkRole = (await hod.get('/api/admin/access/roles')).body.data.find(r => r.key === 'exam_cell');
  const staffList = (await hod.get('/api/admin/access/staff')).body.data;
  const target = staffList.find(s => s.email === 'manager@perm1.edu');
  const assign = await mgr.patch(`/api/admin/access/staff/${target.id}`, { roleIds: [clerkRole._id] });
  assert.equal(assign.status, 403);

  // cannot change own access
  const self = staffList.find(s => s.email === 'roleadmin@perm1.edu');
  const mine = await mgr.patch(`/api/admin/access/staff/${self.id}`, { roleIds: [] });
  assert.equal(mine.status, 403);
  assert.equal(mine.body.error.code, 'SELF_PRIVILEGE_CHANGE');
  void staff; void custom;
});

test('mass assignment cannot smuggle a role or permission into a user or role', async () => {
  const roles = (await hod.get('/api/admin/access/roles')).body.data;
  const viewer = roles.find(r => r.key === 'viewer2');
  const res = await hod.patch(`/api/admin/access/roles/${viewer._id}`, { name: 'Renamed', builtIn: true, college: 'x', permissions: ['fees.view'] });
  assert.equal(res.status, 200);
  const doc = await M.Role.findById(viewer._id);
  assert.equal(doc.builtIn, false);
  assert.equal(String(doc.college), String(ctx.college._id));
  const student = await harness.login(creds(ctx.college, ctx.students[0].user));
  const patch = await student.patch('/api/student/profile', { phone: '123456', role: 'hod', customRoles: [String(viewer._id)] });
  assert.equal(patch.status, 200);
  const u = await M.User.findById(ctx.students[0].user._id);
  assert.equal(u.role, 'student');
  assert.equal(u.customRoles.length, 0);
});

test('revoking a role or deactivating it takes effect on the very next request', async () => {
  const staff = await makeStaff(['fee_viewer'], 'revoke@perm1.edu');
  assert.equal((await staff.get('/api/admin/fees/assignments')).status, 200);
  const role = await M.Role.findOne({ key: 'fee_viewer' });
  await hod.patch(`/api/admin/access/roles/${role._id}`, { active: false });
  assert.equal((await staff.get('/api/admin/fees/assignments')).status, 403);
  await hod.patch(`/api/admin/access/roles/${role._id}`, { active: true });
  assert.equal((await staff.get('/api/admin/fees/assignments')).status, 200);
  const list = (await hod.get('/api/admin/access/staff')).body.data;
  const me = list.find(s => s.email === 'revoke@perm1.edu');
  await hod.patch(`/api/admin/access/staff/${me.id}`, { roleIds: [] });
  assert.equal((await staff.get('/api/admin/fees/assignments')).status, 403);
  await hod.patch(`/api/admin/access/staff/${me.id}`, { active: false });
  assert.equal((await staff.get('/api/auth/me')).status, 401, 'a deactivated account is signed out immediately');
});

test('department-scoped roles only apply inside the user\'s departments', async () => {
  const d1 = (await hod.post('/api/admin/access/departments', { name: 'Computer Science', code: 'cse' })).body.data;
  const d2 = (await hod.post('/api/admin/access/departments', { name: 'Mechanical', code: 'mech' })).body.data;
  assert.equal((await hod.post('/api/admin/access/departments', { name: 'Computer Science', code: 'cs2' })).status, 409);
  await hod.put(`/api/admin/access/sections/${ctx.section._id}/department`, { departmentId: d1._id });
  const sec2 = await M.Section.create({ college: ctx.college._id, name: 'ME-A', nameKey: 'me-a', sem: 'Sem 3', semesterNumber: 3, department: d2._id });
  assert.ok(sec2);

  const head = await makeStaff(['dept_head'], 'head@perm1.edu', [d1._id]);
  const me = (await head.get('/api/auth/me')).body.data.user;
  assert.deepEqual(me.departments, [d1._id]);
  const { allowedSectionIds } = require('../../src/services/permissionService');
  const req = { college: ctx.college, perms: await require('../../src/services/permissionService').resolve(await M.User.findOne({ email: 'head@perm1.edu' })) };
  const ids = (await allowedSectionIds(req, 'attendance.view')).map(String);
  assert.deepEqual(ids, [String(ctx.section._id)]);

  const nobody = await makeStaff(['dept_head'], 'nodept@perm1.edu', []);
  const req2 = { college: ctx.college, perms: await require('../../src/services/permissionService').resolve(await M.User.findOne({ email: 'nodept@perm1.edu' })) };
  assert.deepEqual(await allowedSectionIds(req2, 'attendance.view'), [], 'a department role without departments sees nothing');
  void nobody;
});

test('permissions never cross colleges', async () => {
  const foreign = await M.Role.create({ college: other.college._id, key: 'foreign', name: 'Foreign', permissions: ['fees.view'] });
  const res = await hod.post('/api/admin/access/staff', { name: 'X', email: 'x@perm1.edu', password: PASSWORD, roleIds: [String(foreign._id)] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'ROLE_NOT_FOUND');
});

test('role and access changes are audited', async () => {
  const actions = (await M.AuditLog.find({ college: ctx.college._id }).distinct('action'));
  for (const a of ['role.created', 'role.updated', 'staff.created', 'user.access_changed', 'department.created']) assert.ok(actions.includes(a), a);
});
