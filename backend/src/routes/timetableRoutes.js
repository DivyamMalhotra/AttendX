const router = require('express').Router();
const ctrl = require('../controllers/timetableController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/timetable');

/** Mounted at /api/timetable behind requireAuth. Each route names the permission it needs. */
router.get('/mine', need('attendance.mark'), ctrl.mine);
router.get('/unmarked', need('attendance.view', 'attendance.mark', 'attendance.approveCorrection'), ctrl.unmarked);

// Resolving unmarked classes: also available to staff holding attendance.approveCorrection (not only faculty).
router.post('/sessions/:id/resolve', need('attendance.approveCorrection', 'attendance.mark'), validate(v.resolveSession), ctrl.resolve);
router.post('/sessions/:id/cancel', need('attendance.approveCorrection', 'attendance.mark'), validate(v.cancelSession), ctrl.cancelSession);

router.get('/', need('timetable.view', 'timetable.manage'), validate(v.list), ctrl.list);
router.post('/', need('timetable.manage'), validate(v.create), ctrl.create);
router.post('/generate', need('timetable.manage'), validate(v.generate), ctrl.generate);
router.get('/:id', need('timetable.view', 'timetable.manage'), validate(v.id), ctrl.detail);
router.post('/:id/entries', need('timetable.manage'), validate(v.entry), ctrl.addEntry);
router.delete('/:id/entries/:entryId', need('timetable.manage'), validate(v.entryParam), ctrl.removeEntry);
router.post('/:id/approve', need('timetable.manage'), validate(v.id), ctrl.approve);

module.exports = router;
