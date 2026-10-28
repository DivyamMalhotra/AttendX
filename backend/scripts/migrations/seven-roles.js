/**
 * Moves existing users to the seven supported roles (see src/services/roleMigration.js for the exact mapping).
 *   node scripts/migrations/seven-roles.js            # dry run: prints what would change
 *   node scripts/migrations/seven-roles.js --apply    # applies it (repeatable; already-migrated users are skipped)
 */
const { config } = require('../../src/config/env');
const { connectDb, disconnectDb } = require('../../src/config/db');
const { migrateToSevenRoles } = require('../../src/services/roleMigration');
const { parseArgs } = require('../lib/cli');

(async () => {
  const apply = Boolean(parseArgs().apply);
  await connectDb(config.mongoUri);
  const r = await migrateToSevenRoles({ dryRun: !apply });
  console.log(apply ? 'Applied:' : 'Dry run (use --apply to write):');
  console.log(`  hod -> admin: ${r.toAdmin}; accounts_clerk: ${r.mapped.accounts_clerk}; exam_cell: ${r.mapped.exam_cell}; parents reactivated: ${r.parentsReactivated}`);
  console.log(`  HOD accounts kept (assign departments): ${r.keptHod.length}`);
  r.keptHod.forEach(d => console.log(`    - ${d.name} <${d.email}> departments: ${d.departments}`));
  console.log(`  deactivated (no matching role, kept in the database): ${r.deactivated.length}`);
  r.deactivated.forEach(d => console.log(`    - ${d.name} <${d.email}> was ${d.wasRole}${d.customRoles.length ? ` [${d.customRoles.join(', ')}]` : ''}`));
  await disconnectDb();
})().catch(err => { console.error(err.message); process.exit(1); });
