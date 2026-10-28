const { User, Role, ParentLink } = require('../models');
const audit = require('./auditService');

/**
 * Repeatable move from the old base roles (hod, staff, parent, and the interim "librarian") to the seven supported
 * roles: Administrator, HOD, Teacher, Student, Accounts Clerk, Exam Cell, Parent.
 *
 *   hod        -> admin   for the oldest such account of a college that has no Administrator yet (the old HOD was the
 *                         college head, which is the Administrator's job);
 *                 hod     for every further HOD account (department head; it sees nothing until an Administrator
 *                         assigns departments, and it is listed for review)
 *   staff with the accounts clerk / accounts head role  -> accounts_clerk
 *   staff with the exam cell role                       -> exam_cell
 *   teacher, student, parent                            -> unchanged
 *   everything else (staff with registrar, principal, hostel warden, librarian, counsellor, mentor roles or no role)
 *                                                       -> kept but DEACTIVATED and listed, so nobody silently gets a
 *                                                          different or wider role
 *
 * Parents deactivated by the interim six-role migration are reactivated when they still hold an active verified link.
 * Nothing is deleted; mentor assignments, parent links and history stay in the database.
 */
const STAFF_MAP = [['accounts_clerk', 'accounts_clerk'], ['accounts_head', 'accounts_clerk'], ['exam_cell', 'exam_cell']];

async function migrateToSevenRoles({ collegeId = null, dryRun = false } = {}) {
  const scope = collegeId ? { college: collegeId } : {};
  const report = { toAdmin: 0, keptHod: [], mapped: { accounts_clerk: 0, exam_cell: 0 }, deactivated: [], parentsReactivated: 0 };

  const roles = await Role.find(scope).select('key').lean();
  const keyById = new Map(roles.map(r => [String(r._id), r.key]));
  const users = await User.collection.find({ ...scope, role: { $in: ['hod', 'staff', 'librarian'] } }).sort({ createdAt: 1 }).toArray();
  const hasAdmin = new Map();
  const adminFor = async college => {
    const k = String(college);
    if (!hasAdmin.has(k)) hasAdmin.set(k, Boolean(await User.collection.findOne({ college, role: 'admin' })));
    return hasAdmin.get(k);
  };
  const set = async (u, fields, meta) => {
    if (dryRun) return;
    await User.collection.updateOne({ _id: u._id }, { $set: { ...fields, updatedAt: new Date() } });
    await audit.record({ actor: null, collegeId: u.college, action: 'role.migrated', entityType: 'User', entityId: u._id, meta: { from: u.role, ...meta } });
  };

  for (const u of users) {
    const keys = (u.customRoles || []).map(id => keyById.get(String(id))).filter(Boolean);
    if (u.role === 'hod') {
      if (!(await adminFor(u.college))) {
        hasAdmin.set(String(u.college), true);
        await set(u, { role: 'admin' }, { to: 'admin' });
        report.toAdmin += 1;
      } else {
        report.keptHod.push({ id: String(u._id), name: u.name, email: u.email, departments: (u.departments || []).length });
        await set(u, {}, { to: 'hod', note: 'needs departments assigned' });
      }
    } else {
      const target = u.role === 'staff' ? (STAFF_MAP.find(([key]) => keys.includes(key)) || [])[1] : null;
      if (target) {
        await set(u, { role: target }, { to: target, customRoles: keys });
        report.mapped[target] += 1;
      } else {
        report.deactivated.push({ id: String(u._id), name: u.name, email: u.email, wasRole: u.role, customRoles: keys });
        await set(u, { active: false }, { to: 'deactivated', customRoles: keys });
      }
    }
  }

  const parents = await User.collection.find({ ...scope, role: 'parent', active: false }).toArray();
  for (const p of parents) {
    if (await ParentLink.exists({ parent: p._id, status: 'active' })) {
      if (!dryRun) await User.collection.updateOne({ _id: p._id }, { $set: { active: true, updatedAt: new Date() } });
      report.parentsReactivated += 1;
    }
  }
  if (!dryRun) await Role.updateMany({ ...scope, builtIn: true }, { $set: { active: false } });
  return report;
}

module.exports = { migrateToSevenRoles };
