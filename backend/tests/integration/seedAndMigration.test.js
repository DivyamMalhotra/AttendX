const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');
const { seedStudents, temporaryPassword } = require('../../scripts/lib/seed5g3');
const { migrateToSevenRoles } = require('../../src/services/roleMigration');
const { password: passwordRule } = require('../../src/validators/common');

let ctx; let other; let M;
const LIST = [
  '"BE-CSE(AIML) SEM 5 STUDENT LIST – GROUP 5G3"', '""', '"Sr. No.    Roll. No   Student Name   New Group"', '""',
  '"6       2410992506                    AGAMYA KAUSHAL          5G3"', '""',
  '"20      2410992523                        HIMANSHI            5G3"', '""',
  '"95      2410992614                 MANRAJDEEP SINGH BAJWA     5G3"', ''
].join('\r\n');

before(async () => {
  const { models } = await harness.start();
  M = models;
  ctx = await seedCollege(M, { code: 'SEED1', students: 1 });
  other = await seedCollege(M, { code: 'SEED2', students: 1 });
});
after(() => harness.stop());

test('dry run writes nothing; a bad file aborts before any write', async () => {
  const dry = await seedStudents({ college: ctx.college, text: LIST, apply: false });
  assert.equal(dry.summary.totalRows, 3);
  assert.equal(dry.result.studentsCreated, 3, 'reports what would be created');
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: '2410992506' }), 0);
  assert.equal(await M.Section.countDocuments({ nameKey: '5g3' }), 0);

  const bad = await seedStudents({ college: ctx.college, text: `${LIST}\n"6   2410992506   DUPLICATE   5G3"`, apply: true });
  assert.equal(bad.aborted, true);
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: '2410992506' }), 0, 'nothing was written');
});

test('apply creates students, a section and role accounts with hashed, force-change passwords', async () => {
  const before = { users: await M.User.countDocuments(), others: await M.User.countDocuments({ role: { $ne: 'student' } }) };
  const run = await seedStudents({ college: ctx.college, text: LIST, apply: true });
  assert.deepEqual([run.result.studentsCreated, run.result.studentsReused, run.result.studentsFailed], [3, 0, 0]);
  assert.equal(run.credentials.filter(c => c[2] === 'Student').length, 3);

  const section = await M.Section.findOne({ college: ctx.college._id, nameKey: '5g3' });
  assert.deepEqual([section.sem, section.semesterNumber, section.course, section.specialization], ['Semester 5', 5, 'BE-CSE', 'AIML']);
  const profile = await M.StudentProfile.findOne({ college: ctx.college._id, rollNo: '2410992614' }).populate('user').lean();
  assert.equal(profile.user.name, 'MANRAJDEEP SINGH BAJWA');
  assert.equal(String(profile.section), String(section._id));
  assert.equal(profile.user.role, 'student');
  assert.equal(profile.user.mustChangePassword, true);

  // credentials: strong, unique, valid for the policy, verifiable against the stored hash only
  const passwords = run.credentials.map(c => c[4]);
  assert.equal(new Set(passwords).size, passwords.length, 'unique temporary passwords');
  for (const pw of passwords) assert.ok(passwordRule.safeParse(pw).success && pw.length >= 14, 'meets policy');
  const row = run.credentials.find(c => c[1] === '2410992506');
  const stored = await M.User.findOne({ email: row[3] }).select('+passwordHash');
  assert.notEqual(stored.passwordHash, row[4], 'the plaintext is not what is stored');
  assert.ok(stored.passwordHash.startsWith('$2'), 'salted bcrypt hash');
  assert.ok(await bcrypt.compare(row[4], stored.passwordHash));
  assert.notEqual(row[4], '2410992506', 'the roll number is not the password');
  assert.equal(JSON.stringify(await M.User.find({}).lean()).includes(row[4]), false, 'plaintext appears nowhere in the database');

  // the generated account really signs in, and is forced to change the password
  const agent = await harness.login({ collegeCode: ctx.college.code, email: row[3], password: row[4] });
  assert.equal((await agent.get('/api/student/dashboard')).body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  // role accounts: only roles the college lacked (admin and teacher already existed there); no HOD or parent is invented
  assert.deepEqual(run.credentials.filter(c => c[2] !== 'Student').map(c => c[2]).sort(), ['Accounts Clerk', 'Exam Cell']);
  assert.equal(await M.User.countDocuments({ role: { $ne: 'student' } }), before.others + 2);
  assert.equal(await M.User.countDocuments(), before.users + 5);
});

test('re-running is safe: nothing is duplicated, reset or overwritten', async () => {
  const snapshot = await M.User.find({}).select('+passwordHash').lean();
  const again = await seedStudents({ college: ctx.college, text: LIST, apply: true });
  assert.deepEqual([again.result.studentsCreated, again.result.studentsReused, again.result.rolesCreated], [0, 3, 0]);
  assert.equal(again.credentials.length, 0, 'no credentials are produced for existing accounts');
  const after = await M.User.find({}).select('+passwordHash').lean();
  assert.deepEqual(after.map(u => [String(u._id), u.passwordHash, u.name]).sort(), snapshot.map(u => [String(u._id), u.passwordHash, u.name]).sort());
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: '2410992506' }), 1);
});

test('students outside the list and existing accounts are never touched', async () => {
  const mine = ctx.students[0];
  const before = await M.User.findById(mine.user._id).select('+passwordHash').lean();
  const preset = await M.StudentProfile.create({ college: ctx.college._id, user: (await M.User.create({ college: ctx.college._id, role: 'student', name: 'Pre Existing', email: 'pre@seed1.edu', passwordHash: 'x' }))._id, section: ctx.section._id, rollNo: '2410992999' });
  const more = `${LIST}\r\n"7   2410992999   SOMEONE ELSE   5G3"`;
  const run = await seedStudents({ college: ctx.college, text: more, apply: true });
  assert.deepEqual([run.result.studentsCreated, run.result.studentsReused], [0, 4]);
  const kept = await M.StudentProfile.findById(preset._id);
  assert.equal(String(kept.section), String(ctx.section._id), 'an existing student keeps their section');
  assert.equal((await M.User.findById(preset.user)).name, 'Pre Existing', 'names are not overwritten');
  assert.equal((await M.User.findById(mine.user._id).select('+passwordHash').lean()).passwordHash, before.passwordHash);
});

test('the credentials folder is git-ignored and never served by the web app', async () => {
  const ignore = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.gitignore'), 'utf8');
  assert.match(ignore, /^backend\/credentials\/$/m);
  const agent = await harness.login(creds(ctx.college, ctx.hod));
  for (const url of ['/credentials/', '/credentials/onboarding.csv', '/../credentials/onboarding.csv']) assert.ok([404, 403, 400].includes((await agent.get(url)).status), url);
  assert.ok(temporaryPassword().length >= 14);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'seed-5g3.js'), 'utf8');
  assert.ok(!/console\.(log|error)\([^)]*(password|credentials\[)/i.test(src.replace(/credentials file \(private/, '')), 'the script never prints passwords');
});

test('role migration maps old roles to the seven supported roles without deleting anyone', async () => {
  const col = other.college._id;
  const roles = [];
  for (const key of ['accounts_clerk', 'accounts_head', 'exam_cell', 'registrar', 'hostel_warden', 'librarian']) {
    roles.push(await M.Role.create({ college: col, key, name: key, permissions: ['fees.view'], builtIn: true }));
  }
  const rid = key => roles.find(r => r.key === key)._id;
  const raw = (role, email, keys = [], extra = {}) => M.User.collection.insertOne({ college: col, role, name: email, email, passwordHash: 'h', active: true, customRoles: keys.map(rid), departments: [], createdAt: new Date(), updatedAt: new Date(), ...extra });
  // this college has no Administrator yet: the oldest old head becomes it, a second one stays a HOD
  await M.User.deleteMany({ college: col, role: 'admin' });
  await raw('hod', 'oldhod@seed2.edu', [], { createdAt: new Date(2020, 1, 1) });
  await raw('hod', 'olddept@seed2.edu', [], { createdAt: new Date(2021, 1, 1) });
  await raw('staff', 'oldclerk@seed2.edu', ['accounts_clerk']);
  await raw('staff', 'oldhead@seed2.edu', ['accounts_head']);
  await raw('staff', 'oldcell@seed2.edu', ['exam_cell']);
  await raw('staff', 'oldreg@seed2.edu', ['registrar']);
  await raw('staff', 'oldwarden@seed2.edu', ['hostel_warden']);
  await raw('staff', 'oldlib@seed2.edu', ['librarian']);
  await raw('staff', 'oldnone@seed2.edu', []);
  const parentUser = (await raw('parent', 'oldparent@seed2.edu', [], { active: false })).insertedId;
  const kid = other.students[0].profile._id;
  await M.ParentLink.create({ college: col, parent: parentUser, student: kid, verificationNote: 'checked at the office' });
  const total = await M.User.countDocuments({ college: col });

  const dry = await migrateToSevenRoles({ collegeId: col, dryRun: true });
  assert.equal(dry.toAdmin, 1);
  assert.equal((await M.User.collection.findOne({ email: 'oldhod@seed2.edu' })).role, 'hod', 'a dry run changes nothing');

  const report = await migrateToSevenRoles({ collegeId: col });
  assert.equal(report.toAdmin, 1);
  assert.deepEqual(report.mapped, { accounts_clerk: 2, exam_cell: 1 });
  assert.deepEqual(report.keptHod.map(h => h.email), ['olddept@seed2.edu'], 'a further HOD stays a HOD and is flagged for departments');
  assert.deepEqual(report.deactivated.map(d => d.email).sort(), ['oldlib@seed2.edu', 'oldnone@seed2.edu', 'oldreg@seed2.edu', 'oldwarden@seed2.edu']);
  assert.equal(report.parentsReactivated, 1);
  const get = email => M.User.collection.findOne({ email });
  assert.equal((await get('oldhod@seed2.edu')).role, 'admin');
  assert.equal((await get('olddept@seed2.edu')).role, 'hod');
  assert.equal((await get('oldhead@seed2.edu')).role, 'accounts_clerk');
  assert.equal((await get('oldcell@seed2.edu')).role, 'exam_cell');
  assert.equal((await get('oldparent@seed2.edu')).active, true, 'a parent with a verified link is restored');
  for (const e of ['oldreg', 'oldwarden', 'oldlib', 'oldnone']) {
    const u = await get(`${e}@seed2.edu`);
    assert.equal(u.active, false, `${e} is switched off, not given a broader role`);
    assert.equal(u.role, 'staff', 'the old role is kept for the record');
  }
  assert.equal(await M.User.countDocuments({ college: col }), total, 'nobody was deleted');
  assert.equal(await M.User.countDocuments({ college: col, role: 'admin' }), 1);

  const again = await migrateToSevenRoles({ collegeId: col });
  assert.deepEqual([again.toAdmin, again.mapped.accounts_clerk, again.mapped.exam_cell, again.parentsReactivated], [0, 0, 0, 0], 'safe to run twice');
  assert.ok(await M.AuditLog.findOne({ action: 'role.migrated' }));
});
