/* Creates a backup now:  npm run backup */
require('dotenv').config();
const mongoose = require('mongoose');
const { config } = require('../src/config/env');
const backups = require('../src/services/backupService');

(async () => {
  await mongoose.connect(config.mongoUri);
  try {
    const run = await backups.createBackup();
    console.log(`Backup written: ${run.file} (${run.documents} documents in ${run.collections} collections, ${run.sizeBytes} bytes, sha256 ${run.sha256})`);
    console.log(`Encrypted: ${run.encrypted ? 'yes' : 'NO - set BACKUP_ENCRYPTION_KEY to encrypt backups'}`);
    console.log('Uploaded files are not part of this backup. Copy the UPLOAD_DIR folder separately.');
  } finally { await mongoose.disconnect(); }
})().catch(err => { console.error(`Backup failed: ${err.message}`); process.exit(1); });
