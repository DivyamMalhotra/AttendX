/**
 * Read-only audit: lists students that share a normalized roll number within a college.
 * Exit code 0 = clean, 2 = conflicts found (details written to ./reports).
 *
 *   npm run db:audit-rollnos
 */
const { config } = require('../../src/config/env');
const { connectDb, disconnectDb } = require('../../src/config/db');
const { findDuplicateRollNumbers, writeReport } = require('../lib/rollAudit');

async function main() {
  await connectDb(config.mongoUri);
  const duplicates = await findDuplicateRollNumbers();
  if (!duplicates.length) {
    console.log('✔ No duplicate roll numbers found.');
  } else {
    const file = writeReport('duplicate-roll-numbers', duplicates);
    console.log(`✖ ${duplicates.length} roll number(s) are shared by several students. Nothing was changed.`);
    console.log(`  Review ${file}, correct or deactivate the wrong record(s) in the admin Students page, then re-run.`);
    process.exitCode = 2;
  }
  await disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
