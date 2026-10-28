const router = require('express').Router();
const duty = require('../controllers/dutyLeaveController');
const validate = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const v = require('../validators/dutyLeave');

/** Mounted at /api/duty-leaves behind requireAuth. */
const reviewers = requireRole(ROLES.TEACHER);

router.get('/unassigned', requireRole(ROLES.ADMIN), validate(v.list), duty.unassigned);
router.get('/review', reviewers, validate(v.list), duty.queue);
router.post('/:requestId/review', reviewers, validate(v.review), duty.review);
// Owner or the assigned mentor only (checked in the service).
router.get('/:requestId/document', validate(v.idParam), duty.document);

module.exports = router;
