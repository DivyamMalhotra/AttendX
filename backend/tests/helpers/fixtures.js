const PASSWORD = 'Passw0rd1';

/** Creates one college with an HOD, two teachers, a section, two subjects and four students. */
async function seedCollege(M, { code = 'TST1', students = 4 } = {}) {
  const authService = require('../../src/services/authService');
  const studentService = require('../../src/services/studentService');
  const hash = await authService.hashPassword(PASSWORD);

  const college = await M.College.create({ code, name: `Test College ${code}`, address: 'Test Road' });
  const mk = (role, name, email) => M.User.create({ college: college._id, role, name, email, passwordHash: hash });
  const hod = await mk('admin', 'Dr Hod', `hod@${code.toLowerCase()}.edu`);
  const teacher = await mk('teacher', 'Prof One', `t1@${code.toLowerCase()}.edu`);
  const teacher2 = await mk('teacher', 'Prof Two', `t2@${code.toLowerCase()}.edu`);

  const section = await M.Section.create({
    college: college._id, name: 'CS-B', nameKey: 'cs-b', sem: 'Sem 3', semesterNumber: 3,
    course: 'B.Tech', specialization: 'CSE', mentor: teacher._id
  });
  const ds = await M.Subject.create({ college: college._id, section: section._id, name: 'Data Structures', nameKey: 'data structures', code: 'CS201', teacher: teacher._id });
  const os = await M.Subject.create({ college: college._id, section: section._id, name: 'Operating Systems', nameKey: 'operating systems', code: 'CS202', teacher: teacher2._id });

  const profiles = [];
  for (let i = 1; i <= students; i += 1) {
    const { profile, user } = await studentService.registerStudent(hod, college._id, {
      name: `Student ${i}`, email: `s${i}@${code.toLowerCase()}.edu`, password: PASSWORD, rollNo: `${code}${100 + i}`, sectionId: section._id
    });
    profiles.push({ profile, user });
  }
  await M.User.updateMany({ college: college._id }, { $set: { mustChangePassword: false } });

  const academicSession = await M.AcademicSession.create({ college: college._id, name: '2026-27', startDate: '2026-07-01', endDate: '2027-06-30', isCurrent: true });
  return { college, hod, teacher, teacher2, section, subjects: { ds, os }, students: profiles, academicSession, PASSWORD };
}

// The Administrator can create exactly three kinds of staff account. Old role keys map onto them.
const STAFF_ROLE = { hod: 'hod', accounts_clerk: 'accounts_clerk', accounts_head: 'accounts_clerk', exam_cell: 'exam_cell' };

/** Creates a staff user (through the real admin API) and returns a logged-in session. */
async function makeStaff({ harness, hod, M, ctx, roleKey, email, departmentIds = [] }) {
  const role = STAFF_ROLE[roleKey];
  if (!role) throw new Error(`"${roleKey}" is not a supported staff role`);
  const res = await hod.post('/api/admin/access/staff', { name: roleKey, email, password: PASSWORD, role, departmentIds });
  if (res.status !== 201) throw new Error(`staff create failed: ${JSON.stringify(res.body)}`);
  await M.User.updateOne({ email, college: ctx.college._id }, { $set: { mustChangePassword: false } });
  return harness.login({ collegeCode: ctx.college.code, email, password: PASSWORD });
}

const creds = (college, user) => ({ collegeCode: college.code, email: user.email, password: PASSWORD });

module.exports = { seedCollege, creds, makeStaff, PASSWORD };
