const crypto = require('crypto');
const models = require('../../src/models');
const authService = require('../../src/services/authService');
const audit = require('../../src/services/auditService');
const { ROLES, ROLE_TITLES } = require('../../src/config/constants');
const { parseStudentList } = require('../../src/utils/studentListCsv');

const GROUP = '5G3';
const SECTION = { name: GROUP, sem: 'Semester 5', semesterNumber: 5, course: 'BE-CSE', specialization: 'AIML' };
const keyOf = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const LOGIN_DOMAIN = 'attendx.invalid';

// no look-alike characters (0/O, 1/l/I); always contains letters and digits, as the password policy requires
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function temporaryPassword(length = 14) {
  for (;;) {
    const p = Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) return p;
  }
}

async function createLogin(college, { name, role, email }) {
  const password = temporaryPassword();
  const user = await models.User.create({
    college: college._id, role, name, email, passwordHash: await authService.hashPassword(password),
    mustChangePassword: true, notificationPrefs: { email: false, sms: false }
  });
  return { user, password };
}

/**
 * Seeds the students of the 5G3 list and one account for every role the college does not have yet.
 * Matching is by roll number: existing students and users are never modified, nothing absent from the list is touched.
 * Returns { summary, result, credentials[] } where credentials rows are [name, identifier, role, username, password, 'yes'].
 * With apply=false nothing is written (a dry run reports what would be created).
 */
async function seedStudents({ college, text, apply = false, onError = () => {} }) {
  const parsed = parseStudentList(text, { expectedGroup: GROUP });
  const summary = parsed.summary;
  const result = { studentsCreated: 0, studentsReused: 0, studentsFailed: 0, rolesCreated: 0, rolesReused: 0 };
  const credentials = [];
  if (!summary.ok) return { summary, result, credentials, aborted: true };

  let section = await models.Section.findOne({ college: college._id, nameKey: keyOf(SECTION.name), semesterNumber: SECTION.semesterNumber });
  if (!section && apply) section = await models.Section.create({ college: college._id, ...SECTION, nameKey: keyOf(SECTION.name) });

  for (const row of parsed.students) {
    if (await models.StudentProfile.exists({ college: college._id, rollNo: row.rollNo })) { result.studentsReused += 1; continue; }
    if (!apply) { result.studentsCreated += 1; continue; }
    const email = `${row.rollNo.toLowerCase()}@student.${LOGIN_DOMAIN}`;
    let user;
    try {
      if (await models.User.exists({ college: college._id, email })) throw new Error(`a user with ${email} already exists without a student record; left untouched`);
      const made = await createLogin(college, { name: row.name, role: ROLES.STUDENT, email });
      user = made.user;
      await models.StudentProfile.create({ college: college._id, user: user._id, section: section._id, rollNo: row.rollNo });
      await audit.record({ actor: null, collegeId: college._id, action: 'student.seeded', entityType: 'User', entityId: user._id, meta: { rollNo: row.rollNo, source: '5G3 list' } });
      credentials.push([row.name, row.rollNo, ROLE_TITLES.student, email, made.password, 'yes']);
      result.studentsCreated += 1;
    } catch (err) {
      if (user) await models.User.deleteOne({ _id: user._id });   // no half-created student (standalone MongoDB has no transactions)
      result.studentsFailed += 1;
      onError(`roll ${row.rollNo}: ${err.message}`);
    }
  }

  const roleAccounts = [[ROLES.ADMIN, 'Administrator'], [ROLES.TEACHER, 'Teacher'], [ROLES.ACCOUNTS_CLERK, 'Accounts Clerk'], [ROLES.EXAM_CELL, 'Exam Cell']];
  for (const [role, name] of roleAccounts) {
    if (await models.User.exists({ college: college._id, role, active: true })) { result.rolesReused += 1; continue; }
    if (!apply) { result.rolesCreated += 1; continue; }
    const email = `${role.replace('_', '-')}@${college.code.toLowerCase()}.${LOGIN_DOMAIN}`;
    try {
      const made = await createLogin(college, { name, role, email });
      await audit.record({ actor: null, collegeId: college._id, action: 'role_account.seeded', entityType: 'User', entityId: made.user._id, meta: { role } });
      credentials.push([name, role, ROLE_TITLES[role], email, made.password, 'yes']);
      result.rolesCreated += 1;
    } catch (err) { onError(`${role} account: ${err.message}`); }
  }
  return { summary, result, credentials, aborted: false };
}

module.exports = { seedStudents, temporaryPassword };
