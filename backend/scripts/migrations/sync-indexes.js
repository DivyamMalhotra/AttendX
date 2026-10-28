/**
 * Builds every unique index (roll numbers, attendance, duty leave, transaction ids...)
 * on an EXISTING database. It first audits for duplicate roll numbers and refuses to
 * continue if any exist, so the index build cannot fail halfway or silently drop data.
 * Back up the database before running this on production.
 *
 *   npm run db:sync-indexes
 */
const { config } = require('../../src/config/env');
const { connectDb, disconnectDb } = require('../../src/config/db');
const models = require('../../src/models');
const { findDuplicateRollNumbers, writeReport } = require('../lib/rollAudit');

async function main() {
  await connectDb(config.mongoUri);
  const duplicates = await findDuplicateRollNumbers();
  if (duplicates.length) {
    const file = writeReport('duplicate-roll-numbers', duplicates);
    console.error(`✖ Aborted: ${duplicates.length} duplicate roll number group(s). See ${file}. No index was changed.`);
    process.exitCode = 2;
    return disconnectDb();
  }
  for (const [name, model] of Object.entries(models)) {
    const dropped = await model.syncIndexes();
    console.log(`✔ ${name}${dropped.length ? ` (removed obsolete indexes: ${dropped.join(', ')})` : ''}`);
  }
  return disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
