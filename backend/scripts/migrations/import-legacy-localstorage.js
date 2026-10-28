/**
 * Imports data created by the old browser-only AttendX (localStorage) into MongoDB.
 *
 * 1. In the OLD app's browser tab open DevTools > Console and run:
 *        copy(JSON.stringify(localStorage))
 *    then paste the clipboard into a file, e.g. legacy-export.json
 * 2. Dry run (default, writes nothing, produces a conflict report):
 *        npm run db:import-legacy -- --file legacy-export.json
 * 3. Review reports/legacy-import-*.json, fix conflicts in the export, then import for real:
 *        npm run db:import-legacy -- --file legacy-export.json --commit
 *
 * The import never deletes or merges records. Ambiguous records (for example two students with
 * the same roll number) are held back and listed in the report; re-running after you fix the
 * export is safe because existing records are reused, not duplicated.
 */
const fs = require('fs');
const { config } = require('../../src/config/env');
const { connectDb, disconnectDb } = require('../../src/config/db');
const models = require('../../src/models');
const authService = require('../../src/services/authService');
const { planImport, commitImport } = require('../lib/legacyImport');
const { writeReport } = require('../lib/rollAudit');
const { parseArgs, fail } = require('../lib/cli');

async function main() {
  const args = parseArgs();
  if (!args.file || args.file === true) fail('Pass the exported file: --file legacy-export.json');
  let dump;
  try { dump = JSON.parse(fs.readFileSync(args.file, 'utf8')); } catch (e) { fail(`Could not read ${args.file}: ${e.message}`); }

  const plan = planImport(dump);
  const report = writeReport('legacy-import', { summary: plan.summary, conflicts: plan.conflicts });
  console.log('Import plan:', plan.summary);
  console.log(`Conflict report: ${report}`);
  if (!args.commit) {
    console.log('\nDry run only - nothing was written. Add --commit to import.');
    return;
  }
  await connectDb(config.mongoUri);
  await Promise.all(Object.values(models).map(m => m.init()));
  const stats = await commitImport(plan, { models, hashPassword: authService.hashPassword });
  console.log('\n✔ Import finished.', JSON.stringify(stats));
  console.log('Imported staff/students must change their password at first sign-in (old passwords were stored in plain text).');
  await disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
