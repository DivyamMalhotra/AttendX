const { Section, Subject, User, StudentProfile, ClassSession } = require('../models');
const { ROLES } = require('../config/constants');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const authService = require('./authService');
const audit = require('./auditService');

const keyOf = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

/** Teacher ids must belong to an active teacher of the same college. */
async function assertTeacher(collegeId, teacherId) {
  if (!teacherId) return null;
  const teacher = await User.findOne({ _id: teacherId, college: collegeId, role: ROLES.TEACHER, active: true });
  if (!teacher) throw badRequest('Selected teacher was not found.', undefined, 'TEACHER_NOT_FOUND');
  return teacher;
}

async function findSection(collegeId, id) {
  const section = await Section.findOne({ _id: id, college: collegeId });
  if (!section) throw notFound('Section not found.');
  return section;
}

/* ---------------- sections ---------------- */

async function listSections(collegeId) {
  const [sections, subjects, counts] = await Promise.all([
    Section.find({ college: collegeId }).sort({ semesterNumber: 1, name: 1 }).populate('mentor', 'name email').lean(),
    Subject.find({ college: collegeId }).populate('teacher', 'name email').sort({ name: 1 }).lean(),
    StudentProfile.aggregate([
      { $match: { college: collegeId, active: true } },
      { $group: { _id: '$section', n: { $sum: 1 } } }
    ])
  ]);
  const countBySection = new Map(counts.map(c => [String(c._id), c.n]));
  return sections.map(s => ({
    ...s,
    studentCount: countBySection.get(String(s._id)) || 0,
    subjects: subjects.filter(sub => String(sub.section) === String(s._id))
  }));
}

async function createSection(actor, collegeId, input) {
  try {
    const section = await Section.create({
      college: collegeId, name: input.name, sem: input.sem || `Sem ${input.semesterNumber}`,
      semesterNumber: input.semesterNumber, course: input.course || '', specialization: input.specialization || '',
      nameKey: keyOf(input.name)
    });
    await audit.record({ actor, collegeId, action: 'section.created', entityType: 'Section', entityId: section._id, meta: { name: section.name } });
    return section;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('SECTION_EXISTS', 'A section with that name and semester already exists.');
    throw err;
  }
}

async function updateSection(actor, collegeId, id, input) {
  const section = await findSection(collegeId, id);
  Object.assign(section, input);
  if (input.name) section.nameKey = keyOf(input.name);
  if (input.semesterNumber && !input.sem) section.sem = `Sem ${input.semesterNumber}`;
  try {
    await section.save();
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('SECTION_EXISTS', 'A section with that name and semester already exists.');
    throw err;
  }
  await audit.record({ actor, collegeId, action: 'section.updated', entityType: 'Section', entityId: id, meta: input });
  return section;
}

/** Sections that have students or attendance history are never deleted. */
async function deleteSection(actor, collegeId, id) {
  const section = await findSection(collegeId, id);
  const [students, sessions] = await Promise.all([
    StudentProfile.countDocuments({ section: id }),
    ClassSession.countDocuments({ section: id })
  ]);
  if (students) throw conflict('SECTION_HAS_STUDENTS', 'Cannot delete a section that has enrolled students.');
  if (sessions) throw conflict('SECTION_HAS_HISTORY', 'Cannot delete a section that has attendance history.');
  await Subject.deleteMany({ section: id });
  await section.deleteOne();
  await audit.record({ actor, collegeId, action: 'section.deleted', entityType: 'Section', entityId: id, meta: { name: section.name } });
}

async function setMentor(actor, collegeId, sectionId, mentorId) {
  const section = await findSection(collegeId, sectionId);
  await assertTeacher(collegeId, mentorId);
  section.mentor = mentorId || null;
  await section.save();
  await audit.record({ actor, collegeId, action: 'section.mentor_set', entityType: 'Section', entityId: sectionId, meta: { mentorId } });
  return section;
}

/* ---------------- subjects ---------------- */

async function createSubject(actor, collegeId, sectionId, input) {
  await findSection(collegeId, sectionId);
  await assertTeacher(collegeId, input.teacherId);
  try {
    const subject = await Subject.create({
      college: collegeId, section: sectionId, name: input.name, nameKey: keyOf(input.name),
      code: input.code || '', credits: input.credits || 0, teacher: input.teacherId || null
    });
    await audit.record({ actor, collegeId, action: 'subject.created', entityType: 'Subject', entityId: subject._id, meta: { name: subject.name, teacher: input.teacherId || null } });
    return subject;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('SUBJECT_EXISTS', 'That subject already exists in this section.');
    throw err;
  }
}

async function updateSubject(actor, collegeId, id, input) {
  const subject = await Subject.findOne({ _id: id, college: collegeId });
  if (!subject) throw notFound('Subject not found.');
  if (input.teacherId !== undefined) {
    await assertTeacher(collegeId, input.teacherId);
    subject.teacher = input.teacherId || null;
  }
  if (input.name) { subject.name = input.name; subject.nameKey = keyOf(input.name); }
  if (input.code !== undefined) subject.code = input.code;
  if (input.credits !== undefined) subject.credits = input.credits;
  try {
    await subject.save();
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('SUBJECT_EXISTS', 'That subject already exists in this section.');
    throw err;
  }
  await audit.record({ actor, collegeId, action: 'subject.updated', entityType: 'Subject', entityId: id, meta: input });
  return subject;
}

async function deleteSubject(actor, collegeId, id) {
  const subject = await Subject.findOne({ _id: id, college: collegeId });
  if (!subject) throw notFound('Subject not found.');
  const sessions = await ClassSession.countDocuments({ subject: id });
  if (sessions) throw conflict('SUBJECT_HAS_HISTORY', 'This subject has attendance history. Reassign or unassign its teacher instead of deleting it.');
  await subject.deleteOne();
  await audit.record({ actor, collegeId, action: 'subject.deleted', entityType: 'Subject', entityId: id, meta: { name: subject.name } });
}

/* ---------------- teachers ---------------- */

async function listTeachers(collegeId) {
  const [teachers, subjects] = await Promise.all([
    User.find({ college: collegeId, role: ROLES.TEACHER }).sort({ name: 1 }).lean(),
    Subject.find({ college: collegeId, teacher: { $ne: null } }).populate('section', 'name sem').lean()
  ]);
  return teachers.map(t => ({
    id: String(t._id), name: t.name, email: t.email, active: t.active,
    subjects: subjects.filter(s => String(s.teacher) === String(t._id))
      .map(s => ({ id: String(s._id), name: s.name, section: s.section && { id: String(s.section._id), name: s.section.name, sem: s.section.sem } }))
  }));
}

async function createTeacher(actor, collegeId, input) {
  try {
    const user = await User.create({
      college: collegeId, role: ROLES.TEACHER, name: input.name, email: input.email,
      passwordHash: await authService.hashPassword(input.password), mustChangePassword: true
    });
    await audit.record({ actor, collegeId, action: 'teacher.created', entityType: 'User', entityId: user._id, meta: { email: user.email } });
    return user;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('EMAIL_EXISTS', 'A user with that email already exists.');
    throw err;
  }
}

async function updateTeacher(actor, collegeId, id, input) {
  const teacher = await User.findOne({ _id: id, college: collegeId, role: ROLES.TEACHER });
  if (!teacher) throw notFound('Teacher not found.');
  if (input.name) teacher.name = input.name;
  if (input.active !== undefined) teacher.active = input.active;
  if (input.password) {
    teacher.passwordHash = await authService.hashPassword(input.password);
    teacher.passwordChangedAt = new Date();
    teacher.mustChangePassword = true;
  }
  await teacher.save();
  await audit.record({ actor, collegeId, action: input.password ? 'teacher.password_reset' : 'teacher.updated', entityType: 'User', entityId: id, meta: { active: input.active } });
  return teacher;
}

module.exports = {
  keyOf, listSections, createSection, updateSection, deleteSection, setMentor,
  createSubject, updateSubject, deleteSubject, listTeachers, createTeacher, updateTeacher
};
