const { ParentLink, StudentProfile, User } = require('../models');
const { ROLES } = require('../config/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const authService = require('./authService');
const snapshot = require('./studentSnapshotService');
const feeView = require('./feeViewService');
const audit = require('./auditService');

/**
 * Parent/guardian access is institution-granted: an administrator creates the account and links it to a
 * specific student after verifying the person (the verification note is mandatory). A roll number alone never
 * exposes anything, links can be revoked at once, and parents only ever read — there is no write route.
 */

async function createParent({ actor, college, input }) {
  const profile = await StudentProfile.findOne({ _id: input.studentId, college: college._id, active: true }).select('_id').lean();
  if (!profile) throw badRequest('Student not found.', undefined, 'STUDENT_NOT_FOUND');
  let user;
  try {
    user = await User.create({
      college: college._id, role: ROLES.PARENT, name: input.name, email: input.email, phone: input.phone || '',
      passwordHash: await authService.hashPassword(input.password), mustChangePassword: true
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('EMAIL_EXISTS', 'A user with that email already exists. Link the existing parent account instead.');
    throw err;
  }
  try {
    const link = await createLink({ actor, college, parentId: user._id, studentId: profile._id, relationship: input.relationship, verificationNote: input.verificationNote });
    return { user, link };
  } catch (err) {
    await User.deleteOne({ _id: user._id });   // never leave a parent account with no verified link
    throw err;
  }
}

async function createLink({ actor, college, parentId, studentId, relationship, verificationNote }) {
  const [parent, student] = await Promise.all([
    User.findOne({ _id: parentId, college: college._id, role: ROLES.PARENT, active: true }).select('_id').lean(),
    StudentProfile.findOne({ _id: studentId, college: college._id, active: true }).select('_id').lean()
  ]);
  if (!parent || !student) throw badRequest('Parent or student not found.', undefined, 'LINK_TARGET_NOT_FOUND');
  try {
    const link = await ParentLink.create({ college: college._id, parent: parent._id, student: student._id, relationship: relationship || 'guardian', verificationNote, verifiedBy: actor._id });
    await audit.record({ actor, collegeId: college._id, action: 'parent.linked', entityType: 'ParentLink', entityId: link._id, meta: { student: String(student._id), relationship: link.relationship } });
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
  await audit.record({ actor, collegeId: college._id, action: 'parent.revoked', entityType: 'ParentLink', entityId: id, meta: { reason } });
  return link;
}

const list = async ({ collegeId, studentId }) => ParentLink.find({ college: collegeId, ...(studentId ? { student: studentId } : {}) })
  .populate('parent', 'name email phone active').populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).sort({ createdAt: -1 }).limit(500).lean();

/* ------------------------------------------------------------- parent portal */

async function children(parent) {
  const links = await ParentLink.find({ parent: parent._id, status: 'active' }).populate('student').lean();
  const out = [];
  for (const l of links) {
    if (!l.student || !l.student.active) continue;
    out.push({ ...(await snapshot.identity(l.student)), relationship: l.relationship });
  }
  return out;
}

/** The link that authorises this parent to see this student, or a refusal (404 so other students' existence is not revealed). */
async function authorise(parent, studentId) {
  const link = await ParentLink.findOne({ parent: parent._id, student: studentId, status: 'active' });
  if (!link) throw notFound('Student not found.');
  const profile = await StudentProfile.findById(studentId);
  if (!profile || !profile.active) throw notFound('Student not found.');
  return profile;
}

const visible = (college, key) => {
  if (!college.settings.parentVisibility[key]) throw forbidden('The college does not share this information with parents.', 'NOT_SHARED');
};

/** What a parent may see, per college visibility settings. Every view is audit-logged. */
async function view({ parent, college, studentId, area }) {
  const profile = await authorise(parent, studentId);
  let data;
  switch (area) {
    case 'summary': {
      const pv = college.settings.parentVisibility;
      data = { student: await snapshot.identity(profile) };
      if (pv.attendance) data.attendance = await snapshot.attendance(college, profile);
      if (pv.leave) data.leave = await snapshot.leave(college, profile);
      if (pv.results) data.results = await snapshot.results(profile);
      if (pv.fees) { const f = await snapshot.fees(college, profile); data.fees = { totals: f.totals, items: f.items }; }
      data.shared = pv;
      break;
    }
    case 'attendance': visible(college, 'attendance'); data = await snapshot.attendance(college, profile); break;
    case 'leave': visible(college, 'leave'); data = await snapshot.leave(college, profile); break;
    case 'results': visible(college, 'results'); data = await snapshot.results(profile); break;
    case 'fees': visible(college, 'fees'); data = await snapshot.fees(college, profile); break;
    case 'payments': {
      visible(college, 'payments');
      const history = await feeView.studentHistory({ college, profile });
      data = history.map(({ id, amountPaise, status, paidAt, createdAt, academicSession, semesterNumber, receiptNo }) => ({ id, amountPaise, status, paidAt, createdAt, academicSession, semesterNumber, receiptNo }));
      break;
    }
    default: throw notFound('Not found.');
  }
  await audit.record({ actor: parent, collegeId: college._id, action: 'parent.viewed', entityType: 'StudentProfile', entityId: studentId, meta: { area } });
  return data;
}

module.exports = { createParent, createLink, revoke, list, children, view, authoriseChild: authorise };
