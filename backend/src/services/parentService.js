const { User, StudentProfile, ParentLink } = require('../models');
const { ROLES } = require('../config/constants');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const authService = require('./authService');
const audit = require('./auditService');

/**
 * Parent accounts and their verified links to students. A link is created by the institution (never by the parent) and
 * records how the person was verified; a roll number alone never grants access. A parent can see exactly the students
 * they hold an ACTIVE link to, and only through authoriseChild().
 */

async function createParent({ actor, college, input }) {
  const profile = await StudentProfile.findOne({ _id: input.studentId, college: college._id, active: true });
  if (!profile) throw badRequest('That student was not found in this college.', undefined, 'STUDENT_NOT_FOUND');
  let user;
  try {
    user = await User.create({
      college: college._id, role: ROLES.PARENT, name: input.name, email: input.email, phone: input.phone || '',
      passwordHash: await authService.hashPassword(input.password), mustChangePassword: true
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('EMAIL_EXISTS', 'A user with that email already exists.');
    throw err;
  }
  const link = await ParentLink.create({
    college: college._id, parent: user._id, student: profile._id, relationship: input.relationship || 'guardian',
    verificationNote: input.verificationNote, verifiedBy: actor._id
  });
  await audit.record({ actor, collegeId: college._id, action: 'parent.linked', entityType: 'ParentLink', entityId: link._id, meta: { student: String(profile._id), relationship: link.relationship } });
  return { user, link };
}

/** Links an existing parent account to another (or the same) verified student. */
async function createLink({ actor, college, parentId, studentId, relationship, verificationNote }) {
  const [parent, profile] = await Promise.all([
    User.findOne({ _id: parentId, college: college._id, role: ROLES.PARENT, active: true }).select('_id').lean(),
    StudentProfile.findOne({ _id: studentId, college: college._id, active: true }).select('_id').lean()
  ]);
  if (!parent) throw notFound('Parent account not found.');
  if (!profile) throw notFound('Student not found.');
  try {
    const link = await ParentLink.create({ college: college._id, parent: parent._id, student: profile._id, relationship: relationship || 'guardian', verificationNote, verifiedBy: actor._id });
    await audit.record({ actor, collegeId: college._id, action: 'parent.linked', entityType: 'ParentLink', entityId: link._id, meta: { student: String(profile._id) } });
    return link;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('LINK_EXISTS', 'That parent is already linked to this student.');
    throw err;
  }
}

async function revoke({ actor, college, id, reason }) {
  const link = await ParentLink.findOneAndUpdate({ _id: id, college: college._id, status: 'active' },
    { $set: { status: 'revoked', revokedBy: actor._id, revokedAt: new Date(), revokeReason: reason || '' } }, { returnDocument: 'after' });
  if (!link) throw notFound('Active link not found.');
  await audit.record({ actor, collegeId: college._id, action: 'parent.revoked', entityType: 'ParentLink', entityId: link._id, meta: { reason } });
  return link;
}

async function list({ collegeId, studentId }) {
  const filter = { college: collegeId, status: 'active', ...(studentId ? { student: studentId } : {}) };
  return ParentLink.find(filter).populate('parent', 'name email phone active')
    .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).sort({ createdAt: -1 }).limit(300).lean();
}

/** The parent's active children (students) with just enough to choose one. */
async function children(parent) {
  const links = await ParentLink.find({ parent: parent._id, college: parent.college, status: 'active' })
    .populate({ path: 'student', select: 'rollNo user section active', populate: [{ path: 'user', select: 'name' }, { path: 'section', select: 'name sem' }] }).lean();
  return links.filter(l => l.student && l.student.active).map(l => ({
    studentId: String(l.student._id), name: l.student.user ? l.student.user.name : '', rollNo: l.student.rollNo,
    section: l.student.section ? `${l.student.section.name} · ${l.student.section.sem}` : '', relationship: l.relationship
  }));
}

/**
 * The one place a student id from the client is turned into a profile for a parent. Unlinked, revoked, foreign-college
 * and non-existent ids are all reported as "not found" so students cannot be enumerated.
 */
async function authoriseChild(parent, studentId) {
  const link = await ParentLink.findOne({ parent: parent._id, student: studentId, college: parent.college, status: 'active' }).lean();
  const profile = link && await StudentProfile.findOne({ _id: studentId, college: parent.college, active: true });
  if (!profile) throw notFound('Student not found.');
  return profile;
}

module.exports = { createParent, createLink, revoke, list, children, authoriseChild };
