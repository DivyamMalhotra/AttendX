/**
 * Upgrades a Phase 1 database to the Phase 2 data model. Safe to run repeatedly (every step only touches
 * documents that still lack the new fields) and it never deletes data.
 *
 *   npm run db:phase2            apply
 *   npm run db:phase2 -- --dry-run   only report what would change
 *
 * Steps: class sessions get a lifecycle status and source; attendance gets a source; duty-leave requests are linked
 * to the "duty" leave type and their day rows marked as exempting attendance (the Phase 1 behaviour); fee
 * assignments get category "semester"; every college gets its built-in roles and default leave types; finally the
 * indexes are rebuilt (this replaces the old non-partial fee index with the category-aware one).
 * BACK UP THE DATABASE FIRST (npm run backup).
 */
const { config } = require('../../src/config/env');
const { connectDb, disconnectDb } = require('../../src/config/db');
const models = require('../../src/models');
const accessService = require('../../src/services/accessService');
const leaveTypes = require('../../src/services/leaveTypeService');

const dry = process.argv.includes('--dry-run');

async function count(label, model, filter, update) {
  const n = await model.countDocuments(filter);
  if (!dry && n) await model.collection.updateMany(filter, update);
  console.log(`${dry ? 'would update' : 'updated'} ${String(n).padStart(6)}  ${label}`);
}

async function main() {
  await connectDb(config.mongoUri);
  const { ClassSession, Attendance, DutyLeaveRequest, DutyLeaveDay, FeeAssignment, College, LeaveType } = models;

  await count('class sessions without a status (with attendance -> submitted)', ClassSession, { status: { $exists: false }, $expr: { $gt: [{ $add: ['$counts.present', '$counts.absent'] }, 0] } }, { $set: { status: 'submitted', source: 'legacy' } });
  await count('class sessions without a status (no attendance -> scheduled)', ClassSession, { status: { $exists: false } }, { $set: { status: 'scheduled', source: 'legacy' } });
  await count('attendance records without a source', Attendance, { source: { $exists: false } }, { $set: { source: 'faculty' } });
  await count('fee assignments without a category', FeeAssignment, { category: { $exists: false } }, { $set: { category: 'semester', description: '' } });
  await count('duty-leave day rows without the exempt flag', DutyLeaveDay, { exempt: { $exists: false } }, { $set: { exempt: true } });

  for (const college of await College.find()) {
    if (!dry) {
      await accessService.ensureBuiltInRoles(college._id);
      await leaveTypes.ensureDefaults(college._id);
      const duty = await LeaveType.findOne({ college: college._id, key: 'duty' });
      if (duty) await DutyLeaveRequest.collection.updateMany({ college: college._id, leaveType: { $exists: false } }, { $set: { leaveType: duty._id } });
    }
    console.log(`${dry ? 'would prepare' : 'prepared'} roles, leave types and duty-leave links for ${college.code}`);
  }

  if (dry) { console.log('Dry run: indexes not rebuilt.'); return disconnectDb(); }
  for (const [name, model] of Object.entries(models)) {
    const dropped = await model.syncIndexes();
    if (dropped.length) console.log(`indexes: ${name} removed obsolete ${dropped.join(', ')}`);
  }
  console.log('Phase 2 upgrade finished.');
  return disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
