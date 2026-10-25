const { StudentProfile, Subject, Section } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const { forbidden, notFound, badRequest } = require('../utils/errors');
const { ROLES } = require('../config/constants');
const { isObjectId } = require('../validators/common');

/** Resolves the signed-in student's own profile into req.student. */
const loadOwnStudent = asyncHandler(async (req, res, next) => {
  const profile = await StudentProfile.findOne({ user: req.user._id, college: req.college._id });
  if (!profile || !profile.active) throw forbidden('No active student profile is linked to this account.');
  req.student = profile;
  next();
});

/**
 * Resource ownership for routes that take a student id.
 *  - student: only their own profile
 *  - hod: any student in their college
 *  - teacher: students of a section they teach or mentor
 */
const requireStudentAccess = (param = 'studentId') => asyncHandler(async (req, res, next) => {
  const id = req.params[param];
  if (!isObjectId(id)) throw badRequest('Invalid student id.');
  const target = await StudentProfile.findOne({ _id: id, college: req.college._id });
  if (!target) throw notFound('Student not found.');

  const { role } = req.user;
  if (role === ROLES.STUDENT) {
    if (String(target.user) !== String(req.user._id)) throw forbidden();
  } else if (role === ROLES.TEACHER) {
    const [teaches, mentors] = await Promise.all([
      Subject.exists({ section: target.section, teacher: req.user._id }),
      Section.exists({ _id: target.section, mentor: req.user._id })
    ]);
    if (!teaches && !mentors) throw forbidden();
  }
  req.targetStudent = target;
  next();
});

/** Faculty assignment verification: a teacher may only act on subjects assigned to them. */
const requireSubjectAccess = (param = 'subjectId') => asyncHandler(async (req, res, next) => {
  const id = req.params[param];
  if (!isObjectId(id)) throw badRequest('Invalid subject id.');
  const subject = await Subject.findOne({ _id: id, college: req.college._id });
  if (!subject) throw notFound('Subject not found.');
  if (req.user.role === ROLES.TEACHER && String(subject.teacher) !== String(req.user._id)) {
    throw forbidden('This subject is not assigned to you.');
  }
  req.subject = subject;
  next();
});

module.exports = { loadOwnStudent, requireStudentAccess, requireSubjectAccess };
