/**
 * OPTIONAL demo data: one complete campus ("CAMPUS26") with timetable, results, assignments, notices, library,
 * hostel, fees, mentoring, a parent account and staff in every built-in role.
 *  - refuses to run when NODE_ENV=production
 *  - never touches a college whose code already exists
 *  - generates one random password, prints it once, and every account must change it at first sign-in
 *
 *   npm run seed:campus
 */
const crypto = require('crypto');
const { config } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const models = require('../src/models');
const authService = require('../src/services/authService');
const studentService = require('../src/services/studentService');
const { populateCampus } = require('./lib/campusDemo');
const { TIME_SLOTS } = require('../src/config/constants');
const { todayISO, addDays } = require('../src/utils/dates');

const CODE = 'CAMPUS26';
const DOMAIN = 'campus26.edu';
const STUDENTS = ['Aditya Sharma', 'Priya Nair', 'Rohan Mehta', 'Sneha Kulkarni', 'Arjun Patel', 'Diya Iyer', 'Kabir Singh', 'Meera Joshi'];

async function main() {
  if (config.isProd) throw new Error('Refusing to seed demo data when NODE_ENV=production.');
  await connectDb(config.mongoUri);
  await Promise.all(Object.values(models).map(m => m.init()));
  if (await models.College.exists({ code: CODE })) { console.log(`${CODE} already exists. Nothing was changed.`); return disconnectDb(); }

  const password = `${crypto.randomBytes(5).toString('hex')}A1`;
  const hash = await authService.hashPassword(password);
  const today = todayISO(config.timezone);
  const college = await models.College.create({ code: CODE, name: 'Campus 26 Institute of Technology', address: 'University Road, Chandigarh' });
  const mk = (role, name, email) => models.User.create({ college: college._id, role, name, email, passwordHash: hash, mustChangePassword: true });
  const hod = await mk('hod', 'Dr. Meenakshi Rao', `hod@${DOMAIN}`);
  const teachers = [await mk('teacher', 'Prof. Sameer Khanna', `sameer.khanna@${DOMAIN}`), await mk('teacher', 'Dr. Reema Mathur', `reema.mathur@${DOMAIN}`)];
  const section = await models.Section.create({ college: college._id, name: 'CS-B', nameKey: 'cs-b', sem: 'Sem 3', semesterNumber: 3, course: 'B.Tech', specialization: 'CSE', mentor: teachers[0]._id });
  const subjects = [];
  for (const [i, name] of ['Data Structures', 'Operating Systems'].entries()) {
    subjects.push(await models.Subject.create({ college: college._id, section: section._id, name, nameKey: name.toLowerCase(), code: `CS20${i + 1}`, credits: 4, teacher: teachers[i]._id }));
  }
  const y = new Date().getFullYear();
  const academicSession = await models.AcademicSession.create({ college: college._id, name: `${y}-${String(y + 1).slice(2)}`, startDate: `${y}-01-01`, endDate: `${y}-12-31`, isCurrent: true });

  const profiles = [];
  for (const [i, name] of STUDENTS.entries()) {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');
    const { profile } = await studentService.registerStudent(hod, college._id, { name, email: `${slug}@student.${DOMAIN}`, password, rollNo: `C26${101 + i}`, sectionId: section._id });
    profiles.push(profile);
  }
  // some attendance history so dashboards, alerts and analytics have something to show
  for (let n = 1; n <= 8; n += 1) {
    const date = addDays(today, -n * 2);
    const session = await models.ClassSession.create({ college: college._id, subject: subjects[0]._id, section: section._id, teacher: teachers[0]._id, date, slot: TIME_SLOTS[1], createdBy: teachers[0]._id });
    const records = profiles.map((p, i) => ({ college: college._id, classSession: session._id, student: p._id, subject: subjects[0]._id, section: section._id, date, status: (i === 1 && n % 2 === 0) || (i === 2 && n > 3) ? 'A' : 'P', markedBy: teachers[0]._id }));
    await models.Attendance.insertMany(records);
    const absent = records.filter(r => r.status === 'A').length;
    await models.ClassSession.updateOne({ _id: session._id }, { $set: { status: 'submitted', counts: { present: records.length - absent, absent } } });
  }
  await models.User.updateMany({ college: college._id, role: { $in: ['student', 'teacher', 'hod'] } }, { $set: { mustChangePassword: true } });

  const { accounts, notes } = await populateCampus({ college, hod, teachers, section, subjects, profiles, academicSession, password, domain: DOMAIN, mustChange: true });
  console.log(`\nCollege code: ${CODE}\nPassword for ALL demo users: ${password}   (each must change it at first sign-in)\n`);
  console.log(`  Administrator (HOD): hod@${DOMAIN}`);
  console.log(`  Teachers: sameer.khanna@${DOMAIN}, reema.mathur@${DOMAIN}`);
  console.log(`  Students: ${STUDENTS.slice(0, 3).map(n => `${n.toLowerCase().replace(/[^a-z]+/g, '.')}@student.${DOMAIN}`).join(', ')} ...`);
  accounts.forEach(a => console.log(`  ${a.role}: ${a.email}`));
  if (notes.length) console.log(`\nWarnings:\n${notes.join('\n')}`);
  await disconnectDb();
}

main().catch(err => { console.error(err.message); process.exit(1); });
