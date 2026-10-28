/*
 * Restores a backup into a NEW database so it can be checked first:
 *   npm run restore -- backups/attendx-....ndjson.gz attendx_restored
 * Then point MONGODB_URI at the restored database (or copy collections across) and run `npm run db:sync-indexes`.
 * --verify-only  checks the file (checksum, decryption, document count) without restoring anything.
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const { config } = require('../src/config/env');
const backups = require('../src/services/backupService');

(async () => {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [file, target] = args;
  const verifyOnly = process.argv.includes('--verify-only');
  if (!file || (!target && !verifyOnly)) {
    console.error('Usage: npm run restore -- <backup-file> <target-database-name> [--force]\n       npm run restore -- <backup-file> --verify-only');
    process.exit(2);
  }
  const full = path.resolve(file);
  if (verifyOnly) {
    const v = await backups.verifyFile(full);
    console.log(`OK: ${v.documents} documents in ${v.collections} collections (database "${v.database}", ${v.createdAt}).`);
    return;
  }
  await mongoose.connect(config.mongoUri);
  try {
    const res = await backups.restoreInto({ file: full, targetDb: target, force: process.argv.includes('--force') });
    console.log(`Restored ${res.restored} documents into database "${res.targetDb}".`);
  } finally { await mongoose.disconnect(); }
})().catch(err => { console.error(`Restore failed: ${err.message}`); process.exit(1); });
