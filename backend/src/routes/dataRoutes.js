const router = require('express').Router();
const ctrl = require('../controllers/dataController');
const validate = require('../middleware/validate');
const { uploadFiles, TYPE_SETS } = require('../middleware/upload');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/data');

/** Bulk import (upload -> preview -> confirm) and CSV export, mounted at /api/admin/data behind a console role. */
router.get('/imports', need('imports.manage'), ctrl.list);
router.get('/imports/templates/:kind', need('imports.manage'), validate(v.template), ctrl.template);
router.post('/imports/:kind/preview', need('imports.manage'), uploadFiles('imports', { field: 'file', maxFiles: 1, types: TYPE_SETS.csv, maxBytes: 1_000_000 }), validate(v.preview), ctrl.preview);
router.get('/imports/:id', need('imports.manage'), validate(v.idParam), ctrl.get);
router.post('/imports/:id/confirm', need('imports.manage'), validate(v.confirm), ctrl.confirm);
router.post('/imports/:id/cancel', need('imports.manage'), validate(v.idParam), ctrl.cancel);

router.get('/export/:kind', need('reports.export'), validate(v.exportKind), ctrl.export);

module.exports = router;
