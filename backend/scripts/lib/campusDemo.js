/**
 * Builds a fully populated demo campus (timetable, results, coursework, notices, library, fees, mentoring,
 * staff roles) through the SAME services the application uses, so the demo data obeys every rule of the
 * real system. Used by `npm run seed:campus` and by the end-to-end test server.
 */
const models = require('../../src/models');
const { User, Role, Department, Section } = models;
const { Assignment } = require('../../src/models/Assignment');
const { Announcement } = require('../../src/models/Announcement');
const authService = require('../../src/services/authService');
const studentService = require('../../src/services/studentService');
const accessService = require('../../src/services/accessService');
const leaveTypes = require('../../src/services/leaveTypeService');
const permissionService = require('../../src/services/permissionService');
const timetables = require('../../src/services/timetableService');
const examService = require('../../src/services/examService');
const library = require('../../src/services/libraryService');
const feeStructures = require('../../src/services/feeStructureService');
const feeAssignments = require('../../src/services/feeAssignmentService');
const mentors = require('../../src/services/mentorService');
const parents = require('../../src/services/parentService');
const { TIME_SLOTS, ROLE_TITLES } = require('../../src/config/constants');
const { todayISO, addDays } = require('../../src/utils/dates');

const STAFF = [['accounts_clerk', 'Asha Accounts (clerk)'], ['exam_cell', 'Esha Exam Cell']];
const BANDS = [
  { minPercent: 90, grade: 'O', points: 10 }, { minPercent: 80, grade: 'A+', points: 9 }, { minPercent: 70, grade: 'A', points: 8 },
  { minPercent: 60, grade: 'B', points: 7 }, { minPercent: 50, grade: 'C', points: 6 }, { minPercent: 40, grade: 'D', points: 5 }, { minPercent: 0, grade: 'F', points: 0, pass: false }
];

async function step(log, name, fn) {
  try { return await fn(); } catch (err) { log.push(`! ${name}: ${err.message}`); return null; }
}

/**
 * @param {object} c { college, hod, teachers[], section, subjects[], profiles[] (StudentProfile), academicSession, password, domain, mustChange }
 * @returns {{ accounts: {role,name,email}[], notes: string[] }}
 */
async function populateCampus(c) {
  const log = [];
  const accounts = [];
  const { college, hod, teachers, section, subjects, profiles, academicSession, password, domain } = c;
  const tz = college.settings.timezone;
  const today = todayISO(tz);
  const hodPerms = await permissionService.resolve(hod);
  const hash = await authService.hashPassword(password);

  await step(log, 'roles', async () => { await accessService.ensureBuiltInRoles(college._id); await leaveTypes.ensureDefaults(college._id); });

  const dept = await step(log, 'department', async () => {
    const d = await Department.create({ college: college._id, name: 'Computer Science & Engineering', code: 'CSE', head: hod._id });
    await Section.updateOne({ _id: section._id }, { $set: { department: d._id } });
    return d;
  });

  await step(log, 'demo HOD', async () => {
    const email = `hod.cse@${domain}`;
    await User.create({ college: college._id, role: 'hod', name: 'Demo HOD (CSE)', email, passwordHash: hash, mustChangePassword: Boolean(c.mustChange), departments: dept ? [dept._id] : [] });
    if (dept) await Department.updateOne({ _id: dept._id }, { $set: { head: (await User.findOne({ email }))._id } });
    accounts.push({ role: ROLE_TITLES.hod, name: 'Demo HOD (CSE)', email });
  });

  for (const [key, name] of STAFF) {
    await step(log, `staff ${key}`, async () => {
      const email = `${key.replace('_', '.')}@${domain}`;
      await User.create({ college: college._id, role: key, name, email, passwordHash: hash, mustChangePassword: Boolean(c.mustChange) });
      accounts.push({ role: ROLE_TITLES[key], name, email });
    });
  }

  await step(log, 'timetable', async () => {
    const tt = await timetables.createDraft(hod, college, null, { sectionId: section._id, academicSessionId: academicSession._id, effectiveFrom: addDays(today, -30) });
    for (let dow = 1; dow <= 5; dow += 1) {
      await timetables.addEntry(hod, college, tt._id, { subjectId: subjects[0]._id, dayOfWeek: dow, startTime: '09:00', endTime: '10:00', room: 'R-101' });
      await timetables.addEntry(hod, college, tt._id, { subjectId: subjects[1]._id, dayOfWeek: dow, startTime: '10:15', endTime: '11:15', room: 'R-102' });
    }
    await timetables.approve(hod, college, tt._id);
    await timetables.generate(college._id, today, addDays(today, 6));
  });

  await step(log, 'results', async () => {
    await examService.savePolicy(hod, college._id, { name: '10-point scale', bands: BANDS });
    const exam = await examService.create(hod, college, null, {
      name: 'Mid-term test', type: 'midterm', academicSessionId: academicSession._id, subjectId: subjects[0]._id, date: addDays(today, -5),
      startTime: '10:00', endTime: '11:00', venue: 'Hall A', maxMarks: 50, passMarks: 20
    });
    const teacher = teachers[0];
    const tperms = await permissionService.resolve(teacher);
    const marks = [42, 35, 18, 47, 29, 38, 44, 31];
    await examService.saveMarks({ actor: teacher, perms: tperms, college, id: exam._id, entries: profiles.map((p, i) => ({ studentId: String(p._id), marks: marks[i % marks.length] })) });
    await examService.submit({ actor: teacher, perms: tperms, college, id: exam._id });
    await examService.review({ actor: hod, perms: hodPerms, college, id: exam._id, decision: 'approve' });
    await examService.lock({ actor: hod, perms: hodPerms, college, id: exam._id });
    await examService.publish({ actor: hod, perms: hodPerms, college, id: exam._id });
  });

  await step(log, 'coursework', async () => {
    await Assignment.create({
      college: college._id, subject: subjects[0]._id, section: section._id, title: 'Linked list implementation',
      instructions: 'Implement a singly linked list with insert, delete and reverse. Submit your source file and a short note on complexity.',
      status: 'published', publishAt: null, deadline: new Date(Date.now() + 7 * 86400000), maxMarks: 20, allowLate: false, allowResubmit: true, createdBy: teachers[0]._id
    });
    await Announcement.create({
      college: college._id, title: 'Welcome to the new semester', body: 'Classes follow the published timetable. Attendance below 75% will trigger an alert. Library services are now part of AttendX.',
      priority: 'high', audience: { all: true }, status: 'published', publishedAt: new Date(), author: hod._id, notifiedAt: new Date()
    });
  });

  await step(log, 'library', async () => {
    const a = await library.addBook({ actor: hod, college, input: { title: 'Introduction to Algorithms', author: 'Cormen, Leiserson, Rivest, Stein', isbn: '9780262033848', category: 'Computer Science', copies: 3 } });
    const b = await library.addBook({ actor: hod, college, input: { title: 'Operating System Concepts', author: 'Silberschatz, Galvin, Gagne', isbn: '9781119800361', category: 'Computer Science', copies: 2 } });
    await library.issue({ actor: hod, college, bookId: a.book._id, student: { studentId: profiles[0]._id } });
    const late = await library.issue({ actor: hod, college, bookId: b.book._id, student: { studentId: profiles[1]._id } });
    const { LibraryIssue } = require('../../src/models/Facilities');
    await LibraryIssue.updateOne({ _id: late._id }, { $set: { issuedOn: addDays(today, -20), dueDate: addDays(today, -6) } });
  });

  await step(log, 'fees', async () => {
    const s = await feeStructures.create(hod, college._id, {
      course: section.course, specialization: section.specialization, academicSessionId: academicSession._id, semesterNumber: section.semesterNumber,
      components: [{ name: 'Tuition fee', kind: 'tuition', amountPaise: 9000000 }, { name: 'Examination fee', kind: 'examination', amountPaise: 1000000 }, { name: 'Registration fee', kind: 'registration', amountPaise: 500000 }],
      dueDate: addDays(today, 20)
    });
    await feeAssignments.assign({ actor: hod, college, structureId: s._id, sectionId: section._id });
  });

  await step(log, 'mentoring', async () => {
    await mentors.assign({ actor: hod, college, studentIds: profiles.map(p => p._id), mentorId: teachers[0]._id, reason: 'Semester allocation' });
    const tperms = await permissionService.resolve(teachers[0]);
    await mentors.addNote({ actor: teachers[0], perms: tperms, college, studentId: profiles[1]._id, input: { content: 'Discussed recent absences and a plan to catch up on labs.', category: 'attendance', followUpAction: 'Check attendance again', followUpDate: addDays(today, 7) } });
  });

  await step(log, 'parent', async () => {
    const user = await User.findById(profiles[0].user).select('name email').lean();
    const email = `parent.${user.email}`;
    await parents.createParent({ actor: hod, college, input: { name: `Parent of ${user.name}`, email, password, studentId: profiles[0]._id, relationship: 'mother', verificationNote: 'Identity checked against admission records (demo data)' } });
    accounts.push({ role: 'Parent', name: `Parent of ${user.name}`, email });
    if (!c.mustChange) await User.updateOne({ email }, { $set: { mustChangePassword: false } });
  });

  return { accounts, notes: log, department: dept && dept.code };
}

module.exports = { populateCampus };
