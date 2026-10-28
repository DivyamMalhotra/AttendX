const { Role, Section } = require('../models');
const { BASE_ROLE_PERMISSIONS, DEPARTMENT_ROLES, PERMISSIONS, NOT_IMPLICIT } = require('../config/permissions');

const ALL = PERMISSIONS.map(p => p.key);

/**
 * Computes what a user may do. Base-role permissions come from code, extra permissions from the
 * administrator-defined roles attached to the user. Roles with scope "department" only apply inside
 * the departments assigned to the user. This is evaluated on every request, so revoking a role,
 * deactivating a role or removing a department takes effect immediately.
 */
async function resolve(user) {
  const base = BASE_ROLE_PERMISSIONS[user.role] || [];
  const everything = base.includes('*');
  const departmental = DEPARTMENT_ROLES.includes(user.role);
  const college = new Set(everything ? ALL.filter(p => !NOT_IMPLICIT.has(p)) : (departmental ? [] : base));
  const dept = new Set(departmental ? base : []);

  if (user.customRoles && user.customRoles.length) {
    const roles = await Role.find({ _id: { $in: user.customRoles }, college: user.college, active: true }).lean();
    for (const role of roles) {
      const target = role.scope === 'department' ? dept : college;
      role.permissions.forEach(p => target.add(p));
    }
  }
  const departments = (user.departments || []).map(String);

  const scopeFor = perm => {
    if (college.has(perm) || (everything && !NOT_IMPLICIT.has(perm))) return { all: true };
    if (dept.has(perm) && departments.length) return { all: false, departments };
    return null;
  };
  return {
    isSuper: everything,
    can: perm => Boolean(scopeFor(perm)),
    canAny: perms => perms.some(p => Boolean(scopeFor(p))),
    scopeFor,
    list: () => [...new Set([...college, ...dept])].sort(),
    departments
  };
}

/**
 * Section ids a user may see for a permission, or null when unrestricted.
 * Department-scoped users only see sections of their own departments.
 */
async function allowedSectionIds(req, perm) {
  const scope = req.perms.scopeFor(perm);
  if (!scope) return [];
  if (scope.all) return null;
  const sections = await Section.find({ college: req.college._id, department: { $in: scope.departments } }).select('_id').lean();
  return sections.map(s => s._id);
}

module.exports = { resolve, allowedSectionIds, ALL };
