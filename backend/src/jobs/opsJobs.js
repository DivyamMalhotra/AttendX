const runner = require('./runner');
const backups = require('../services/backupService');
const { ImportBatch, PasswordResetToken } = require('../models');
const { config } = require('../config/env');

/** Scheduled logical backup (see services/backupService.js). A failure is recorded in BackupRun and in the job history. */
runner.defineJob({
  name: 'backup', intervalMin: Math.max(1, config.backup.intervalHours) * 60, lockMinutes: 90,
  async run() {
    const run = await backups.createBackup();
    return { file: run.file, documents: run.documents, sizeBytes: run.sizeBytes };
  }
});

/** Housekeeping: stale import previews, old import row data, used or expired password reset tokens. */
runner.defineJob({
  name: 'cleanup', intervalMin: 60 * 12, lockMinutes: 30,
  async run() {
    const day = 86400000;
    const stalePreviews = await ImportBatch.deleteMany({ status: { $in: ['previewed', 'cancelled'] }, expiresAt: { $lt: new Date(Date.now() - 7 * day) } });
    const trimmed = await ImportBatch.updateMany({ status: { $in: ['completed', 'failed'] }, updatedAt: { $lt: new Date(Date.now() - 90 * day) }, 'rows.0': { $exists: true } }, { $set: { rows: [] } });
    const tokens = await PasswordResetToken.deleteMany({ expiresAt: { $lt: new Date(Date.now() - 7 * day) } });
    return { importPreviewsDeleted: stalePreviews.deletedCount, importRowsPurged: trimmed.modifiedCount, resetTokensDeleted: tokens.deletedCount };
  }
});
