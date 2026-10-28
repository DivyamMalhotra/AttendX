const { Role, User, Department, Section } = require('../models');
const { ROLES, STAFF_ROLE_KEYS } = require('../config/constants');
const { PERMISSIONS, PERMISSION_KEYS, NOT_IMPLICIT, ROLE_TEMPLATES } = require('../config/permissions');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const authService = require('./authService');
const permissionService = require('./permissionService');
const audit = require('./auditService');

/** Creates the built-in role templates for a college (idempotent; never overwrites an edited role). */
async function ensureBuiltInRoles(collegeId) {
  await Promise.all(ROLE_TEMPLATES.map(t => Role.updateOne(
    { college: collegeId, key: t.key },
    { $setOnInsert: { name: t.name, description: t.description, permissions: t.permissions, scope: t.scope, builtIn: true, active: true } },
    { upsert: true }
  )));
}

const listRoles = async collegeId => {
  await ensureBuiltInRoles(collegeId);
  return Role.find({ college: collegeId }).sort({ builtIn: -1, name: 1 }).lean();
};

/**
 * Anti-escalation rule: nobody can put a permission into a role (or onto a user) unless they hold it
 * themselves, so the ability to manage roles can never be used to gain more power than you already have.
 */
function assertCanGrant(actorPerms, permissions) {
  // The college administrator may create counsellor-style roles (confidential permissions the wildcard does
  // not include) for OTHER people; they still cannot read the notes themselves.
  const missing = permissions.filter(p => !actorPerms.can(p) && !(actorPerms.isSuper && NOT_IMPLICIT.has(p)));
  if (missing.length) throw forbidden(`You cannot grant permissions you do not hold: ${missing.join(', ')}.`, 'PERMISSION_ESCALATION');
}

function validatePermissions(permissions) {
  const unknown = permissions.filter(p => !PERMISSION_KEYS.has(p));
  if (unknown.length) throw badRequest(`Unknown permission(s): ${unknown.join(', ')}`, undefined, 'UNKNOWN_PERMISSION');
}

async function createRole(actor, perms, collegeId, input) {
  validatePermissions(input.permissions);
  assertCanGrant(perms, input.permissions);
  try {
    const role = await Role.create({ college: collegeId, key: input.key, name: input.name, description: input.description || '', permissions: [...new Set(input.permissions)], scope: input.scope || 'college', builtIn: false });
    await audit.record({ actor, collegeId, action: 'role.created', entityType: 'Role', entityId: role._id, meta: { key: role.key, permissions: role.permissions } });
    return role;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('ROLE_EXISTS', 'A role with that key already exists.');
    throw err;
  }
}

async function updateRole(actor, perms, collegeId, id, input) {
  const role = await Role.findOne({ _id: id, college: collegeId });
  if (!role) throw notFound('Role not found.');
  if (role.builtIn) throw badRequest('Built-in roles cannot be edited. Create a custom role instead.', undefined, 'BUILTIN_ROLE');
  const before = { permissions: role.permissions, scope: role.scope, active: role.active };
  if (input.permissions) {
    validatePermissions(input.permissions);
    // you may also not strip permissions you cannot see; keep it simple: require holding the full new set
    assertCanGrant(perms, input.permissions);
    role.permissions = [...new Set(input.permissions)];
  }
  ['name', 'description', 'scope', 'active'].forEach(k => { if (input[k] !== undefined) role[k] = input[k]; });
  await role.save();
  await audit.record({ actor, collegeId, action: 'role.updated', entityType: 'Role', entityId: id, meta: { before, after: { permissions: role.permissions, scope: role.scope, active: role.active } } });
  return role;
}

const STAFF_ROLES = [...STAFF_ROLE_KEYS, ROLES.TEACHER];

async function assertRolesGrantable(actor, perms, collegeId, roleIds) {
  const roles = await Role.find({ _id: { $in: roleIds }, college: collegeId, active: true }).lean();
  if (roles.length !== new Set(roleIds.map(String)).size) throw badRequest('One or more roles were not found.', undefined, 'ROLE_NOT_FOUND');
  roles.forEach(r => assertCanGrant(perms, r.permissions));
  return roles;
}

async function assertDepartments(collegeId, ids) {
  const n = await Department.countDocuments({ _id: { $in: ids }, college: collegeId, active: true });
  if (n !== new Set(ids.map(String)).size) throw badRequest('One or more departments were not found.', undefined, 'DEPARTMENT_NOT_FOUND');
}

async function createStaff(actor, perms, collegeId, input) {
  if (!STAFF_ROLE_KEYS.includes(input.role)) throw badRequest('Choose HOD, Accounts Clerk or Exam Cell.', undefined, 'INVALID_ROLE');
  const roleIds = [];
  await assertDepartments(collegeId, input.departmentIds || []);
  try {
    const user = await User.create({
      college: collegeId, role: input.role, name: input.name, email: input.email, phone: input.phone || '',
      passwordHash: await authService.hashPassword(input.password), mustChangePassword: true,
      customRoles: roleIds, departments: input.departmentIds || []
    });
    await audit.record({ actor, collegeId, action: 'staff.created', entityType: 'User', entityId: user._id, meta: { roles: roleIds, email: user.email } });
    return user;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('EMAIL_EXISTS', 'A user with that email already exists.');
    throw err;
  }
}

/** Change a staff/faculty member's roles, departments or active flag. Users can never change their own roles. */
async function updateUserAccess(actor, perms, collegeId, id, input) {
  if (String(actor._id) === String(id)) throw forbidden('You cannot change your own roles or departments.', 'SELF_PRIVILEGE_CHANGE');
  const user = await User.findOne({ _id: id, college: collegeId, role: { $in: STAFF_ROLES } });
  if (!user) throw notFound('Staff member not found.');
  const before = { roles: user.customRoles.map(String), departments: user.departments.map(String), active: user.active };
  if (input.departmentIds) { await assertDepartments(collegeId, input.departmentIds); user.departments = input.departmentIds; }
  if (input.active !== undefined) user.active = input.active;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.password) {
    user.passwordHash = await authService.hashPassword(input.password);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = true;
  }
  await user.save();
  await audit.record({ actor, collegeId, action: 'user.access_changed', entityType: 'User', entityId: id, meta: { before, after: { roles: user.customRoles.map(String), departments: user.departments.map(String), active: user.active } } });
  return user;
}

async function listStaff(collegeId) {
  const users = await User.find({ college: collegeId, role: { $in: STAFF_ROLES } }).populate('customRoles', 'name key').populate('departments', 'name code').sort({ name: 1 }).lean();
  return users.map(u => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, active: u.active, roles: u.customRoles, departments: u.departments }));
}

/* ---------------- departments ---------------- */

const listDepartments = async collegeId => {
  const [departments, counts] = await Promise.all([
    Department.find({ college: collegeId }).populate('head', 'name').sort({ name: 1 }).lean(),
    Section.aggregate([{ $match: { college: collegeId, department: { $ne: null } } }, { $group: { _id: '$department', n: { $sum: 1 } } }])
  ]);
  const byDept = new Map(counts.map(c => [String(c._id), c.n]));
  return departments.map(d => ({ ...d, sectionCount: byDept.get(String(d._id)) || 0 }));
};

async function saveDepartment(actor, collegeId, id, input) {
  try {
    let dept;
    if (id) {
      dept = await Department.findOne({ _id: id, college: collegeId });
      if (!dept) throw notFound('Department not found.');
      Object.assign(dept, input);
      await dept.save();
    } else {
      dept = await Department.create({ college: collegeId, ...input });
    }
    await audit.record({ actor, collegeId, action: id ? 'department.updated' : 'department.created', entityType: 'Department', entityId: dept._id, meta: input });
    return dept;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('DEPARTMENT_EXISTS', 'A department with that name or code already exists.');
    throw err;
  }
}

/** Assigns a section to a department (null clears it). */
async function setSectionDepartment(actor, collegeId, sectionId, departmentId) {
  if (departmentId) await assertDepartments(collegeId, [departmentId]);
  const section = await Section.findOneAndUpdate({ _id: sectionId, college: collegeId }, { $set: { department: departmentId || null } }, { returnDocument: 'after' });
  if (!section) throw notFound('Section not found.');
  await audit.record({ actor, collegeId, action: 'section.department_set', entityType: 'Section', entityId: sectionId, meta: { departmentId } });
  return section;
}

const catalogue = () => PERMISSIONS;

module.exports = {
  ensureBuiltInRoles, listRoles, createRole, updateRole, createStaff, updateUserAccess, listStaff,
  listDepartments, saveDepartment, setSectionDepartment, catalogue, assertCanGrant, permissionService
};
