const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { planImport, commitImport } = require('../../scripts/lib/legacyImport');
const { findDuplicateRollNumbers } = require('../../scripts/lib/rollAudit');

let M;
before(async () => { M = (await harness.start()).models; });
after(() => harness.stop());

const slot = '9:00 AM – 10:00 AM';
const legacy = {
  attendx_colleges: JSON.stringify([{ id: 'col1', code: 'GEC24', name: 'Government Engineering College' }]),
  attendx_users: JSON.stringify([
    { id: 'u_hod', name: 'Dr A', email: 'hod@gec.edu', password: 'hod123', role: 'hod', collegeId: 'col1' },
    { id: 'u_t1', name: 'Prof T', email: 't@gec.edu', password: 'teacher123', role: 'teacher', collegeId: 'col1' }
  ]),
  attendx_sections: JSON.stringify([{ id: 'sec1', name: 'CS-B', sem: 'Sem 3', collegeId: 'col1', mentorId: 'u_t1' }]),
  attendx_subjects: JSON.stringify([{ id: 'sub1', name: 'Data Structures', sectionId: 'sec1', teacherId: 'u_t1', collegeId: 'col1' }]),
  attendx_students: JSON.stringify([
    { id: 'st1', rollNo: 'GEC21101', name: 'A', sectionId: 'sec1', collegeId: 'col1', email: 'a@s.edu', password: 'student123' },
    { id: 'st2', rollNo: 'gec21102', name: 'B', sectionId: 'sec1', collegeId: 'col1', email: 'b@s.edu', password: 'student123' },
    { id: 'st3', rollNo: ' GEC21102 ', name: 'B-twin', sectionId: 'sec1', collegeId: 'col1', email: 'b2@s.edu', password: 'student123' },
    { id: 'st4', rollNo: 'GEC21104', name: 'No login', sectionId: 'sec1', collegeId: 'col1' }
  ]),
  attendx_sessions: JSON.stringify([
    { id: 'ss1', subjectId: 'sub1', sectionId: 'sec1', teacherId: 'u_t1', date: '2026-03-02', slot, attendance: { st1: 'P', st2: 'A', st3: 'P' } },
    { id: 'ss2', subjectId: 'sub1', sectionId: 'sec1', teacherId: 'u_t1', date: '2026-03-02', slot, attendance: { st1: 'A' } },
    { id: 'ss3', subjectId: 'sub1', sectionId: 'sec1', teacherId: 'u_t1', date: '2026-03-02', slot: '10:00 AM – 11:00 AM', attendance: { st1: 'A' } }
  ]),
  attendx_leave_requests: JSON.stringify([
    { id: 'lv1', studentId: 'st1', mentorId: 'u_t1', fromDate: '2026-03-02', toDate: '2026-03-03', reason: 'Sports', status: 'approved', requestedAt: 1, respondedAt: 2 },
    { id: 'lv2', studentId: 'st1', mentorId: 'u_t1', fromDate: '2026-03-03', toDate: '2026-03-03', reason: 'Sports again', status: 'pending', requestedAt: 3 },
    { id: 'lv3', studentId: 'st1', mentorId: 'u_t1', fromDate: '2026-03-10', toDate: '2026-03-10', reason: 'Medical', status: 'declined', requestedAt: 4, respondedAt: 5 }
  ])
};

test('planning flags ambiguous records instead of guessing, merging or deleting', () => {
  const plan = planImport(legacy);
  const types = plan.conflicts.map(c => c.type);
  assert.ok(types.includes('duplicate_roll_number'));
  assert.ok(types.includes('student_without_email'));
  assert.ok(types.includes('duplicate_session'));
  assert.ok(types.includes('duplicate_leave'));
  assert.deepEqual(plan.students.map(s => s.id), ['st1'], 'both students sharing GEC21102 are held back');
  const dup = plan.conflicts.find(c => c.type === 'duplicate_roll_number');
  assert.equal(dup.normalizedRollNo, 'GEC21102');
  assert.equal(dup.students.length, 2);
  assert.equal(plan.sessions.length, 2, 'the second record for the same slot is not imported');
  assert.equal(plan.leaves.find(l => l.id === 'lv2').status, 'cancelled');
  assert.equal(plan.leaves.find(l => l.id === 'lv3').status, 'rejected', 'declined maps to rejected');
});

test('commit imports valid data, hashes legacy plaintext passwords and is idempotent', async () => {
  const plan = planImport(legacy);
  const deps = { models: M, hashPassword: require('../../src/services/authService').hashPassword };
  const first = await commitImport(plan, deps);
  assert.equal(first.created.student, 1);
  assert.equal(await M.User.countDocuments(), 3);
  const hod = await M.User.findOne({ email: 'hod@gec.edu' }).select('+passwordHash');
  assert.match(hod.passwordHash, /^\$2/);
  assert.equal(hod.mustChangePassword, true);
  assert.equal(await M.Attendance.countDocuments(), 2);
  assert.equal(await M.DutyLeaveDay.countDocuments({ active: true }), 2, 'only the approved request holds active days');
  assert.equal(await M.DutyLeaveRequest.countDocuments(), 3);

  const again = await commitImport(planImport(legacy), deps);
  assert.equal(again.created.student, undefined);
  assert.equal(await M.Attendance.countDocuments(), 2);
  assert.equal(await M.DutyLeaveRequest.countDocuments(), 3);
  assert.equal(await M.ClassSession.countDocuments(), 2);
});

test('after the conflict is fixed in the export, a re-run adds the missing students and their attendance', async () => {
  const fixed = { ...legacy, attendx_students: JSON.stringify(JSON.parse(legacy.attendx_students).map(s => (s.id === 'st3' ? { ...s, rollNo: 'GEC21103' } : s))) };
  const stats = await commitImport(planImport(fixed), { models: M, hashPassword: require('../../src/services/authService').hashPassword });
  assert.equal(stats.created.student, 2, 'st2 and st3 are no longer in conflict');
  assert.equal(await M.StudentProfile.countDocuments(), 3);
  assert.equal(await M.Attendance.countDocuments({ classSession: (await M.ClassSession.findOne({ date: '2026-03-02', slot })) }), 3);
});

test('the duplicate audit detects collisions that predate the unique index (raw collection)', async () => {
  const profiles = M.StudentProfile.collection;
  const sample = await M.StudentProfile.findOne().lean();
  assert.deepEqual(await findDuplicateRollNumbers(), []);
  await profiles.dropIndex('college_1_rollNo_1');
  await profiles.insertOne({ ...sample, _id: new (require('mongoose').Types.ObjectId)(), user: new (require('mongoose').Types.ObjectId)(), rollNo: ` ${sample.rollNo.toLowerCase()}` });
  const dups = await findDuplicateRollNumbers();
  assert.equal(dups.length, 1);
  assert.equal(dups[0].records.length, 2);
  assert.equal(await M.StudentProfile.countDocuments(), 4, 'the audit itself deletes nothing');
});
