/* Starts an isolated app for the Playwright tests: in-memory MongoDB, a seeded demo campus, known TEST passwords. */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'e2e-secret-e2e-secret-e2e-secret-123456';
process.env.PAYMENT_PROVIDER = 'simulator';
process.env.BCRYPT_ROUNDS = '4';
process.env.PORT = process.env.E2E_PORT || '4010';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), `attendx-e2e-${process.pid}`);

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('attendx_e2e');
  await mongoose.connect(uri);
  const models = require('../src/models');
  await Promise.all(Object.values(models).map(m => m.init()));
  const authService = require('../src/services/authService');
  const studentService = require('../src/services/studentService');
  const { populateCampus } = require('./lib/campusDemo');
  const { TIME_SLOTS } = require('../src/config/constants');
  const { todayISO, addDays } = require('../src/utils/dates');

  const PASSWORD = 'Passw0rd1';
  const hash = await authService.hashPassword(PASSWORD);
  const college = await models.College.create({ code: 'E2E', name: 'E2E College' });
  const mk = (role, name, email) => models.User.create({ college: college._id, role, name, email, passwordHash: hash });
  const hod = await mk('admin', 'Hod E2E', 'admin@e2e.edu');
  const teachers = [await mk('teacher', 'Teacher One', 't1@e2e.edu'), await mk('teacher', 'Teacher Two', 't2@e2e.edu')];
  const section = await models.Section.create({ college: college._id, name: 'CS-B', nameKey: 'cs-b', sem: 'Sem 3', semesterNumber: 3, course: 'B.Tech', specialization: 'CSE', mentor: teachers[0]._id });
  const subjects = [];
  for (const [i, n] of ['Data Structures', 'Operating Systems'].entries()) {
    subjects.push(await models.Subject.create({ college: college._id, section: section._id, name: n, nameKey: n.toLowerCase(), code: `CS20${i}`, credits: 4, teacher: teachers[i]._id }));
  }
  const y = new Date().getFullYear();
  const academicSession = await models.AcademicSession.create({ college: college._id, name: `${y}`, startDate: `${y}-01-01`, endDate: `${y}-12-31`, isCurrent: true });
  const profiles = [];
  for (let i = 1; i <= 4; i += 1) {
    const r = await studentService.registerStudent(hod, college._id, { name: `Student ${i}`, email: `s${i}@e2e.edu`, password: PASSWORD, rollNo: `E2E10${i}`, sectionId: section._id });
    profiles.push(r.profile);
  }
  const today = todayISO(college.settings.timezone);
  for (let n = 1; n <= 4; n += 1) {
    const date = addDays(today, -n);
    const s = await models.ClassSession.create({ college: college._id, subject: subjects[0]._id, section: section._id, teacher: teachers[0]._id, date, slot: TIME_SLOTS[1], status: 'submitted' });
    await models.Attendance.insertMany(profiles.map((p, i) => ({ college: college._id, classSession: s._id, student: p._id, subject: subjects[0]._id, section: section._id, date, status: i === 1 ? 'A' : 'P' })));
  }
  const out = await populateCampus({ college, hod, teachers, section, subjects, profiles, academicSession, password: PASSWORD, domain: 'e2e.edu', mustChange: false });
  await models.User.updateMany({ college: college._id }, { $set: { mustChangePassword: false } });
  if (out.notes.length) console.warn(out.notes.join('\n'));

  const { createSessionMiddleware } = require('../src/config/session');
  const { createApp } = require('../src/app');
  const app = createApp({ sessionMiddleware: createSessionMiddleware({ mongoUrl: uri }) });
  app.listen(Number(process.env.PORT), () => console.log(`E2E server ready on ${process.env.PORT}`));
  const stop = async () => { await mongoose.disconnect(); await mongod.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch(e => { console.error(e); process.exit(1); });
