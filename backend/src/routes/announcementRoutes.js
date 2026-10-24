const router = require('express').Router();
const ctrl = require('../controllers/announcementController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const { uploadFiles, TYPE_SETS } = require('../middleware/upload');
const v = require('../validators/announcements');

/** Mounted at /api/announcements behind requireAuth. Reading is open to every signed-in role (filtered by audience). */
router.get('/', validate(v.feed), ctrl.feed);
router.post('/:id/read', validate(v.id), ctrl.read);

router.get('/manage', ctrl.manage);   // publishers see their scope, everyone else only their own drafts (service-enforced)
router.post('/', need('announcements.publish'), uploadFiles('announcements', { maxFiles: 3, types: TYPE_SETS.coursework }), validate(v.create), ctrl.create);
router.patch('/:id', validate(v.update), ctrl.update);
router.post('/:id/publish', need('announcements.publish'), validate(v.id), ctrl.publish);
router.post('/:id/withdraw', need('announcements.publish'), validate(v.id), ctrl.withdraw);
router.get('/:id/stats', validate(v.id), ctrl.stats);

module.exports = router;
