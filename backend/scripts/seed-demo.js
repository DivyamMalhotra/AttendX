/**
 * OPTIONAL demo data for evaluation. Never run against real data:
 *  - refuses to run when NODE_ENV=production
 *  - never touches a college whose code already exists (nothing is overwritten or deleted)
 *  - generates random passwords and prints them once; nothing is hardcoded
 *
 *   npm run seed:demo
 */
const crypto = require('crypto');
const { config } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const models = require('../src/models');
const authService = require('../src/services/authService');
const studentService = require('../src/services/studentService');
const { TIME_SLOTS } = require('../src/config/constants');
const { todayISO, addDays } = require('../src/utils/dates');

const DEMO = [
  { code: 'GEC24', name: 'Government Engineering College', course: 'B.Tech', spec: 'CSE', section: 'CS-B', sem: 3, subjects: ['Data Structures', 'Operating Systems'],
    hod: ['Dr. Anjali Verma', 'hod@gec.edu'], teachers: [['Dr. Reema Mathur', 'r.mathur@gec.edu'], ['Prof. Sameer Khanna', 's.khanna@gec.edu']],
    students: ['Aditya Sharma', 'Priya Nair', 'Rohan Mehta', 'Sneha Kulkarni', 'Arjun Patel'], roll: 'GEC21' },
  { code: 'ABC24', name: 'ABC Institute of Technology', course: 'B.Tech', spec: 'IT', section: 'IT-A', sem: 5, subjects: ['Database Systems', 'Computer Networks'],
    hod: ['Dr. Karan Malhotra', 'hod@abcinstitute.edu'], teachers: [['Prof. Neha Kapoor', 'n.kapoor@abcinstitute.edu'], ['Dr. Vikas Choudhary', 'v.choudhary@abcinstitute.edu']],
    students: ['Diya Iyer', 'Kabir Singh', 'Meera Joshi', 'Vikram Rao', 'Ananya Desai'], roll: 'ABC23' }
];

const randomPassword = () => `${crypto.randomBytes(5).toString('hex')}A1`;

async function main() {
  if (config.isProd) throw new Error('Refusing to seed demo data when NODE_ENV=production.');
  await connectDb(config.mongoUri);
  await Promise.all(Object.values(models).map(m => m.init()));
  const today = todayISO(config.timezone);
  const printed = [];

  for (const d of DEMO) {
    if (await models.College.exists({ code: d.code })) { console.log(`Skipping ${d.code}: already exists`); continue; }
    const password = randomPassword();
    const hash = await authService.hashPassword(password);
    const college = await models.College.create({ code: d.code, name: d.name });
    const mk = (role, [name, email]) => models.User.create({ college: college._id, role, name, email, passwordHash: hash });
    const hod = await mk('hod', d.hod);
    const teachers = [];
    for (const t of d.teachers) teachers.push(await mk('teacher', t));
    const section = await models.Section.create({
      college: college._id, name: d.section, nameKey: d.section.toLowerCase(), sem: `Sem ${d.sem}`, semesterNumber: d.sem,
      course: d.course, specialization: d.spec, mentor: teachers[0]._id
    });
    const subjects = [];
    for (const [i, name] of d.subjects.entries()) {
      subjects.push(await models.Subject.create({ college: college._id, section: section._id, name, nameKey: name.toLowerCase(), teacher: teachers[i % teachers.length]._id }));
    }
    await models.AcademicSession.create({ college: college._id, name: `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`, startDate: `${new Date().getFullYear()}-07-01`, endDate: `${new Date().getFullYear() + 1}-06-30`, isCurrent: true });

    const students = [];
    for (const [i, name] of d.students.entries()) {
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');
      const { profile } = await studentService.registerStudent(hod, college._id, {
        name, email: `${slug}@student.${d.hod[1].split('@')[1]}`, password, rollNo: `${d.roll}${101 + i}`, sectionId: section._id
      });
      students.push(profile);
    }
    // two sample sessions on the first subject so the dashboards are not empty
    for (const [n, offset] of [[0, -14], [1, -7]]) {
      const date = addDays(today, offset);
      const statuses = students.map((s, i) => ((n === 0 ? i === 3 : i === 1 || i === 2) ? 'A' : 'P'));
      const absent = statuses.filter(s => s === 'A').length;
      const session = await models.ClassSession.create({
        college: college._id, subject: subjects[0]._id, section: section._id, teacher: teachers[0]._id, date, slot: TIME_SLOTS[1],
        createdBy: teachers[0]._id, counts: { present: statuses.length - absent, absent }
      });
      await models.Attendance.insertMany(students.map((s, i) => ({
        college: college._id, classSession: session._id, student: s._id, subject: subjects[0]._id, section: section._id, date,
        status: statuses[i], markedBy: teachers[0]._id
      })));
    }
    await models.User.updateMany({ college: college._id }, { $set: { mustChangePassword: true } });
    printed.push({ code: d.code, password, hod: d.hod[1], teacher: d.teachers[0][1], student: `${d.students[0].toLowerCase().replace(/[^a-z]+/g, '.')}@student.${d.hod[1].split('@')[1]}` });
  }

  printed.forEach(p => console.log(`\n${p.code}  password for ALL demo users of this college: ${p.password}\n  HOD: ${p.hod}\n  Teacher: ${p.teacher}\n  Student: ${p.student}\n  (each user must change this password at first sign-in)`));
  if (!printed.length) console.log('Nothing to seed.');
  await disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
