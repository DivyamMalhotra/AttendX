const { User, StudentProfile, Section } = require('../models');
const { ROLES } = require('../config/constants');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey, duplicateFields } = require('../utils/mongoErrors');
const { normalizeRollNo, isValidRollNo } = require('../utils/rollNumber');
const { escapeRegex } = require('../utils/pagination');
const authService = require('./authService');
const audit = require('./auditService');

function parseRollNo(raw) {
  const rollNo = normalizeRollNo(raw);
  if (!isValidRollNo(rollNo)) {
    throw badRequest('Roll number must be 3-25 letters, digits, "-" or "/".', [{ field: 'rollNo', message: 'Invalid roll number format.' }], 'INVALID_ROLL_NUMBER');
  }
  return rollNo;
}

const rollConflict = rollNo => conflict('ROLL_NUMBER_EXISTS', `Roll number ${rollNo} is already registered.`, [{ field: 'rollNo', message: 'Already registered.' }]);

/**
 * Registers a student: a login User plus a StudentProfile holding the roll number.
 * Uniqueness is enforced by MongoDB unique indexes, so simultaneous requests cannot both
 * succeed. If the profile insert loses a race, the freshly created user is removed again.
 */
async function registerStudent(actor, collegeId, input) {
  const rollNo = parseRollNo(input.rollNo);
  const section = await Section.findOne({ _id: input.sectionId, college: collegeId });
  if (!section) throw badRequest('Selected section was not found.', undefined, 'SECTION_NOT_FOUND');

  // Cheap pre-check for a friendly error; the unique index below is the real guarantee.
  if (await StudentProfile.exists({ college: collegeId, rollNo })) throw rollConflict(rollNo);

  let user;
  try {
    user = await User.create({
      college: collegeId, role: ROLES.STUDENT, name: input.name, email: input.email,
      passwordHash: await authService.hashPassword(input.password), mustChangePassword: true
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('EMAIL_EXISTS', 'A user with that email already exists.', [{ field: 'email', message: 'Already registered.' }]);
    throw err;
  }

  try {
    const profile = await StudentProfile.create({
      college: collegeId, user: user._id, section: section._id, rollNo,
      phone: input.phone || '', admissionYear: input.admissionYear
    });
    await audit.record({ actor, collegeId, action: 'student.registered', entityType: 'StudentProfile', entityId: profile._id, meta: { rollNo, email: user.email } });
    return { user, profile };
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    if (isDuplicateKey(err) && duplicateFields(err).includes('rollNo')) throw rollConflict(rollNo);
    throw err;
  }
}

/** Administrator edits. Roll number changes are restricted to this path and audited. */
async function updateStudent(actor, collegeId, id, input) {
  const profile = await StudentProfile.findOne({ _id: id, college: collegeId });
  if (!profile) throw notFound('Student not found.');
  const user = await User.findById(profile.user);
  const before = { rollNo: profile.rollNo, section: String(profile.section), active: profile.active };

  if (input.rollNo !== undefined) {
    const rollNo = parseRollNo(input.rollNo);
    if (rollNo !== profile.rollNo) profile.rollNo = rollNo;
  }
  if (input.sectionId) {
    const section = await Section.findOne({ _id: input.sectionId, college: collegeId });
    if (!section) throw badRequest('Selected section was not found.', undefined, 'SECTION_NOT_FOUND');
    profile.section = section._id;
  }
  if (input.phone !== undefined) profile.phone = input.phone;
  if (input.admissionYear !== undefined) profile.admissionYear = input.admissionYear;
  if (input.active !== undefined) { profile.active = input.active; user.active = input.active; }
  if (input.name) user.name = input.name;
  if (input.password) {
    user.passwordHash = await authService.hashPassword(input.password);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = true;
  }

  try {
    await profile.save();
  } catch (err) {
    if (isDuplicateKey(err)) throw rollConflict(profile.rollNo);
    throw err;
  }
  await user.save();
  await audit.record({
    actor, collegeId, action: before.rollNo !== profile.rollNo ? 'student.roll_number_changed' : 'student.updated',
    entityType: 'StudentProfile', entityId: id, meta: { before, after: { rollNo: profile.rollNo, section: String(profile.section), active: profile.active }, passwordReset: Boolean(input.password) }
  });
  return { user, profile };
}

/** Fields a student may change on their own profile. */
async function updateOwnProfile(profile, input) {
  if (input.phone !== undefined) profile.phone = input.phone;
  await profile.save();
  return profile;
}

async function listStudents(collegeId, { q, sectionId, includeInactive, skip = 0, limit = 50, sectionIds = null }) {
  const filter = { college: collegeId };
  if (sectionIds) {
    // department-scoped viewers: a requested section outside the scope simply returns nothing
    filter.section = sectionId ? (sectionIds.some(s => String(s) === String(sectionId)) ? sectionId : { $in: [] }) : { $in: sectionIds };
  } else if (sectionId) filter.section = sectionId;
  if (!includeInactive) filter.active = true;

  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ college: collegeId, role: ROLES.STUDENT, $or: [{ name: rx }, { email: rx }] }).select('_id').lean();
    filter.$or = [{ rollNo: new RegExp(escapeRegex(q.toUpperCase().replace(/\s+/g, ''))) }, { user: { $in: users.map(u => u._id) } }];
  }

  const [total, rows] = await Promise.all([
    StudentProfile.countDocuments(filter),
    StudentProfile.find(filter).sort({ rollNo: 1 }).skip(skip).limit(limit)
      .populate('user', 'name email active').populate('section', 'name sem').lean()
  ]);
  return { total, rows };
}

module.exports = { registerStudent, updateStudent, updateOwnProfile, listStudents, parseRollNo };
