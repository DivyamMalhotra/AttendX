const router = require('express').Router();
const ctrl = require('../controllers/assignmentController');
const validate = require('../middleware/validate');
const { loadOwnStudent } = require('../middleware/ownership');
const { requireRole } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const v = require('../validators/assignments');

/**
 * Mounted at /api/files behind requireAuth. Private coursework files (attachments, student submissions,
 * study material) are only ever served here, after the service has checked the caller's right to that file.
 */
const roles = requireRole(ROLES.STUDENT, ROLES.TEACHER, ROLES.HOD, ROLES.STAFF, ROLES.PARENT);
const studentContext = (req, res, next) => (req.user.role === ROLES.STUDENT ? loadOwnStudent(req, res, next) : next());

router.get('/:kind/:id', roles, studentContext, validate(v.fileNoIndex), ctrl.download);
router.get('/:kind/:id/:index', roles, studentContext, validate(v.file), ctrl.download);

module.exports = router;
