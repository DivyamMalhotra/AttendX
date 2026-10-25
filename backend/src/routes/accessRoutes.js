const router = require('express').Router();
const ctrl = require('../controllers/accessController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/permissions');
const v = require('../validators/access');

/** Mounted at /api/admin/access behind requireAuth. Anti-escalation rules live in accessService. */
const manage = requirePermission('roles.manage');
const roster = requirePermission('roster.manage');

router.get('/permissions', manage, ctrl.permissions);
router.get('/roles', manage, ctrl.roles);
router.post('/roles', manage, validate(v.roleCreate), ctrl.createRole);
router.patch('/roles/:id', manage, validate(v.roleUpdate), ctrl.updateRole);

router.get('/staff', manage, ctrl.staff);
router.post('/staff', manage, validate(v.staffCreate), ctrl.createStaff);
router.patch('/staff/:id', manage, validate(v.staffUpdate), ctrl.updateStaff);

router.get('/departments', requirePermission('roster.manage', 'roles.manage', 'analytics.view'), ctrl.departments);
router.post('/departments', roster, validate(v.departmentSave), ctrl.createDepartment);
router.patch('/departments/:id', roster, validate(v.departmentUpdate), ctrl.updateDepartment);
router.put('/sections/:id/department', roster, validate(v.sectionDepartment), ctrl.setSectionDepartment);

module.exports = router;
