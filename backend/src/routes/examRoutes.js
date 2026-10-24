const router = require('express').Router();
const ctrl = require('../controllers/examController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/exams');

/** Mounted at /api/admin/exams behind requireAuth + a console role. */
router.get('/grading-policy', need('exams.configure', 'results.view', 'results.publish'), ctrl.policy);
router.put('/grading-policy', need('exams.configure'), validate(v.policy), ctrl.savePolicy);
router.get('/verify', need('results.view'), validate(v.verify), ctrl.verify);
router.get('/report-card/:studentId', need('results.view'), validate(v.adminReportCard), ctrl.adminReportCard);

router.get('/', need('exams.configure', 'results.view', 'marks.review', 'results.publish'), validate(v.list), ctrl.list);
router.post('/', need('exams.configure'), validate(v.create), ctrl.create);
router.patch('/:id', need('exams.configure'), validate(v.update), ctrl.update);
router.delete('/:id', need('exams.configure'), validate(v.id), ctrl.remove);
router.get('/:id/marks', need('exams.configure', 'results.view', 'marks.review', 'results.publish'), validate(v.id), ctrl.sheet);
router.post('/:id/review', need('marks.review'), validate(v.review), ctrl.review);
router.post('/:id/lock', need('results.publish'), validate(v.id), ctrl.lock);
router.post('/:id/publish', need('results.publish'), validate(v.id), ctrl.publish);
router.post('/:id/reopen', need('results.reopen'), validate(v.reopen), ctrl.reopen);

module.exports = router;
