const router = require('express').Router();
const ctrl = require('../controllers/systemController');
const { requirePermission: need } = require('../middleware/permissions');

/** Mounted at /api/admin/system behind requireAuth + a console role. */
router.get('/jobs', need('system.health', 'system.jobs'), ctrl.jobStatus);
router.post('/jobs/:name/run', need('system.jobs'), ctrl.runJob);

const backups = require('../services/backupService');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
router.get('/backups', need('system.backup', 'system.health'), asyncHandler(async (req, res) => res.json({ data: await backups.list() })));
router.post('/backups', need('system.backup'), asyncHandler(async (req, res) => {
  const run = await backups.createBackup();
  await audit.fromRequest(req, { action: 'system.backup_created', entityType: 'Backup', entityId: String(run._id), meta: { documents: run.documents, encrypted: run.encrypted } });
  res.status(201).json({ data: { id: String(run._id), status: run.status, file: run.file, documents: run.documents, sizeBytes: run.sizeBytes, encrypted: run.encrypted } });
}));
router.post('/backups/:id/verify', need('system.backup'), asyncHandler(async (req, res) => res.json({ data: await backups.verifyRun(req.params.id) })));

module.exports = router;
