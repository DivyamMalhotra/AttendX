/**
 * Seeds the students of BE-CSE(AIML) Semester 5, Group 5G3 from the university's list, plus one account for each of
 * the other supported roles when the college has none, and writes a PRIVATE onboarding credentials file.
 *
 *   node scripts/seed-5g3.js --college-code GEC24 --file "C:/path/5G3_Student_List.csv"            # dry run: summary only
 *   node scripts/seed-5g3.js --college-code GEC24 --file "C:/path/5G3_Student_List.csv" --apply    # writes data
 *
 * Safe to run again: students are matched by roll number; existing students and users are never changed (no password
 * reset, no overwrite) and nobody absent from the file is touched. Only newly created accounts get a temporary
 * password; it is stored as a salted bcrypt hash, must be changed at first login, and is written ONLY to the
 * credentials file (never to the console, the logs, the database in plain text or the frontend).
 *
 * The list has no e-mail addresses. Sign-in uses an e-mail-shaped handle, so each new student gets
 * "<rollno>@student.attendx.invalid" (a reserved, undeliverable domain: nothing is fabricated about the student and
 * notification mail/SMS is switched off for these accounts). Staff can replace it with a real address later.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { config } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const models = require('../src/models');
const { toCsv } = require('../src/utils/csv');
const { seedStudents } = require('./lib/seed5g3');
const { parseArgs, fail } = require('./lib/cli');

function restrictToOwner(file) {
  try { fs.chmodSync(file, 0o600); } catch (e) { /* not supported on this file system */ }
  if (process.platform === 'win32') {
    try { execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { stdio: 'ignore' }); } catch (e) { /* best effort */ }
  }
}

function writeCredentials(rows) {
  const dir = path.join(__dirname, '..', 'credentials');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `onboarding-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  const labels = ['Name', 'Roll number / identifier', 'Role', 'Username', 'Temporary password', 'Must change password on first login'];
  fs.writeFileSync(out, toCsv(labels.map((label, i) => ({ label, value: r => r[i] })), rows), { mode: 0o600 });
  restrictToOwner(out);
  return out;
}

async function main() {
  const args = parseArgs();
  const code = String(args['college-code'] || '').toUpperCase();
  const file = args.file && args.file !== true ? String(args.file) : null;
  const apply = Boolean(args.apply);
  if (!code || !file) fail('Usage: node scripts/seed-5g3.js --college-code CODE --file path/to/5G3_Student_List.csv [--apply]');
  if (!fs.existsSync(file)) fail(`File not found: ${file}`);

  await connectDb(config.mongoUri);
  await Promise.all(Object.values(models).map(m => m.init()));
  const college = await models.College.findOne({ code });
  if (!college) fail(`College ${code} does not exist. Create it first with npm run admin:create.`);

  const { summary: s, result, credentials, aborted } = await seedStudents({ college, text: fs.readFileSync(file, 'utf8'), apply, onError: msg => console.error(msg) });
  console.log('--- List validation ---');
  console.log(`rows found: ${s.totalRows} | valid: ${s.validRows} | invalid: ${s.invalidRows} | unreadable lines: ${s.unparsedLines}`);
  console.log(`duplicate roll numbers: ${s.duplicateRolls.length} | rows with missing fields: ${s.missingFields} | groups: ${s.groups.join(', ') || 'none'}`);
  if (aborted) { console.error(`ABORTED, nothing written: ${s.blocking.join(' ')}`); process.exitCode = 2; await disconnectDb(); return; }

  console.log(`--- ${apply ? 'Result' : 'Dry run (nothing written; use --apply)'} ---`);
  console.log(`students: ${result.studentsCreated} ${apply ? 'created' : 'would be created'}, ${result.studentsReused} already existed (untouched), ${result.studentsFailed} failed`);
  console.log(`role accounts: ${result.rolesCreated} ${apply ? 'created' : 'would be created'}, ${result.rolesReused} roles already had an account (reused)`);
  if (apply && credentials.length) console.log(`credentials file (private, not for Git): ${writeCredentials(credentials)}  [${credentials.length} accounts]`);
  await disconnectDb();
}

module.exports = { writeCredentials };

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });
