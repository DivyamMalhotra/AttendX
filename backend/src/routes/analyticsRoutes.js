const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/analytics');

/** Mounted at /api/admin/analytics behind a console role. Department-scoped roles only see their own sections. */
router.get('/overview', need('analytics.view'), validate(v.overview), ctrl.overview);
router.get('/at-risk', need('analytics.atRisk'), validate(v.atRisk), ctrl.atRisk);

module.exports = router;
