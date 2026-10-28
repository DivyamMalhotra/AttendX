const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, PASSWORD } = require('../helpers/fixtures');
const { todayISO, addDays } = require('../../src/utils/dates');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let t1; let t2; let cell; let s1; let s2; let box;
const today = todayISO('Asia/Kolkata');

const BANDS = [
  { minPercent: 90, grade: 'A', points: 10 }, { minPercent: 75, grade: 'B', points: 8 },
  { minPercent: 50, grade: 'C', points: 5 }, { minPercent: 0, grade: 'F', points: 0, pass: false }
];
// every exam gets its own time window and venue so the scheduler's clash rule never interferes with unrelated tests
let windowNo = 0;
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const examBody = (over = {}) => {
  windowNo += 1;
  return {
    name: 'Final Exam', type: 'final', academicSessionId: String(ctx.academicSession._id), subjectId: String(ctx.subjects.ds._id),
    date: today, startTime: hhmm(300 + windowNo * 40), endTime: hhmm(300 + windowNo * 40 + 30), venue: `Hall ${windowNo}`, maxMarks: 100, passMarks: 40, ...over
  };
};
const entries = values => ctx.students.map((s, i) => ({ studentId: String(s.profile._id), ...(values[i] === 'AB' ? { absent: true } : { marks: values[i] }) }));
const sheet = async (agent, id) => (await agent.get(`/api/faculty/exams/${id}/marks`)).body.data;

async function makeStaff(roleKey, email) {
  return require('../helpers/fixtures').makeStaff({ harness, hod, M, ctx, roleKey, email });
}

/** Creates an exam and takes it to the requested stage through the real API. */
async function examAt(stage, name, subject, teacherAgent, values, over = {}) {
  const created = await hod.post('/api/admin/exams', examBody({ name, subjectId: String(subject._id), ...over }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data._id;
  if (stage === 'draft') return id;
  assert.equal((await teacherAgent.put(`/api/faculty/exams/${id}/marks`, { entries: entries(values) })).status, 200);
  if (stage === 'marks_entry') return id;
  assert.equal((await teacherAgent.post(`/api/faculty/exams/${id}/submit`)).status, 200);
  if (stage === 'submitted') return id;
  assert.equal((await cell.post(`/api/admin/exams/${id}/review`, { decision: 'approve' })).status, 200);
  if (stage === 'reviewed') return id;
  assert.equal((await cell.post(`/api/admin/exams/${id}/lock`)).status, 200);
  if (stage === 'locked') return id;
  assert.equal((await cell.post(`/api/admin/exams/${id}/publish`)).status, 200);
  return id;
}

before(async () => {
  const { models } = await harness.start();
  M = models;
  box = installFakeProviders();
  ctx = await seedCollege(M, { code: 'EXAM1', students: 3 });
  await require('../../src/services/accessService').ensureBuiltInRoles(ctx.college._id);
  await M.Subject.updateOne({ _id: ctx.subjects.ds._id }, { $set: { credits: 4 } });
  await M.Subject.updateOne({ _id: ctx.subjects.os._id }, { $set: { credits: 2 } });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
  cell = await makeStaff('exam_cell', 'cell@exam1.edu');
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('results cannot be published before the institution defines its grading policy', async () => {
  assert.equal((await t1.put('/api/admin/exams/grading-policy', { name: 'x', bands: BANDS })).status, 403);
  const id = await examAt('locked', 'Policy probe', ctx.subjects.ds, t1, [80, 70, 60], { date: addDays(today, 0) });
  const res = await cell.post(`/api/admin/exams/${id}/publish`);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'NO_GRADING_POLICY');
  const bad = await cell.put('/api/admin/exams/grading-policy', { name: 'Bad', bands: [{ minPercent: 40, grade: 'P', points: 5 }] });
  assert.equal(bad.body.error.code, 'INVALID_GRADING_POLICY');
  assert.equal((await cell.put('/api/admin/exams/grading-policy', { name: 'University scale', bands: BANDS })).status, 200);
  assert.equal((await cell.get('/api/admin/exams/grading-policy')).body.data.version, 1);
});

test('scheduling validates input, blocks clashes and tells the students', async () => {
  assert.equal((await t1.post('/api/admin/exams', examBody({ name: 'Nope' }))).status, 403, 'faculty cannot schedule');
  assert.equal((await hod.post('/api/admin/exams', examBody({ name: 'AA', passMarks: 150 }))).body.error.code, 'INVALID_MARKS');
  assert.equal((await hod.post('/api/admin/exams', examBody({ name: 'BB', startTime: '14:00', endTime: '13:00' }))).body.error.code, 'INVALID_TIME');
  assert.equal((await hod.post('/api/admin/exams', examBody({ name: 'CC', components: [{ name: 'Theory', maxMarks: 60 }, { name: 'Viva', maxMarks: 30 }] }))).body.error.code, 'COMPONENTS_MISMATCH');

  const date = addDays(today, 20);
  const first = await hod.post('/api/admin/exams', examBody({ name: 'Mid Sem', type: 'midterm', date, startTime: '10:00', endTime: '13:00', venue: 'Hall A', components: [{ name: 'Theory', maxMarks: 70 }, { name: 'Viva', maxMarks: 30 }] }));
  assert.equal(first.status, 201);
  assert.equal((await hod.post('/api/admin/exams', examBody({ name: 'Mid Sem', date, startTime: '18:00', endTime: '19:00', venue: 'Hall Q' }))).status, 409, 'same name for the same subject and session');
  const clash = await hod.post('/api/admin/exams', examBody({ name: 'OS Mid', subjectId: String(ctx.subjects.os._id), date, startTime: '12:00', endTime: '14:00', venue: 'Other hall' }));
  assert.equal(clash.body.error.code, 'EXAM_CONFLICT', 'same section, overlapping time');
  assert.equal((await hod.post('/api/admin/exams', examBody({ name: 'OS Mid', subjectId: String(ctx.subjects.os._id), date, startTime: '13:00', endTime: '15:00' }))).status, 201, 'back to back is fine');

  assert.equal(await M.Notification.countDocuments({ user: ctx.students[0].user._id, type: 'exam' }) >= 1, true);
  await require('../../src/services/deliveryService').processQueue();
  assert.ok(box.emails.some(e => e.subject === 'AttendX: Examination notice'), 'students are e-mailed once the queue runs');
});

test('marks entry: assigned faculty only, bounded, all-or-nothing, with a full change history', async () => {
  const id = await examAt('draft', 'Quiz 1', ctx.subjects.ds, t1, []);
  assert.equal((await t2.put(`/api/faculty/exams/${id}/marks`, { entries: entries([50, 50, 50]) })).status, 403, "another teacher's exam");
  assert.equal((await s1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([50, 50, 50]) })).status, 403);

  const bad = await t1.put(`/api/faculty/exams/${id}/marks`, { entries: [
    { studentId: String(ctx.students[0].profile._id), marks: 101 }, { studentId: String(ctx.students[1].profile._id), marks: -1 },
    { studentId: String(ctx.students[2].profile._id), absent: true, marks: 5 }, { studentId: String(ctx.hod._id), marks: 10 }
  ] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details.length, 4);
  assert.equal(await M.MarksEntry.countDocuments({ exam: id }), 0, 'nothing is saved when any row is invalid');

  const ok = await t1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([55, 'AB', 61.5]) });
  assert.equal(ok.body.data.changed, 3);
  assert.equal((await M.Exam.findById(id)).status, 'marks_entry');
  await t1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([56, 'AB', 61.5]) });
  const row = await M.MarksEntry.findOne({ exam: id, student: ctx.students[0].profile._id });
  assert.equal(row.history.length, 2);
  assert.deepEqual(row.history.map(h => h.marks), [55, 56]);
  assert.equal(String(row.history[1].by), String(ctx.teacher._id));
  const again = await t1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([56, 'AB', 61.5]) });
  assert.equal(again.body.data.changed, 0, 'unchanged rows create no history');
  assert.ok(row.final === undefined || row.final.state === undefined, 'no official result exists yet');
  const future = await hod.post('/api/admin/exams', examBody({ name: 'Future', date: addDays(today, 40) }));
  assert.equal((await t1.put(`/api/faculty/exams/${future.body.data._id}/marks`, { entries: entries([1, 2, 3]) })).body.error.code, 'EXAM_NOT_HELD');
});

test('submission needs complete marks; after it faculty cannot edit, review, lock or publish', async () => {
  const id = await examAt('marks_entry', 'Quiz 2', ctx.subjects.ds, t1, [70, 80, null].map(v => v));
  // the third student has no marks (null) and is not absent
  const incomplete = await t1.post(`/api/faculty/exams/${id}/submit`);
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.body.error.code, 'INCOMPLETE_MARKS');
  await t1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([70, 80, 'AB']) });
  assert.equal((await t1.post(`/api/faculty/exams/${id}/submit`)).status, 200);

  assert.equal((await t1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([99, 99, 99]) })).body.error.code, 'MARKS_LOCKED');
  assert.equal((await t1.post(`/api/admin/exams/${id}/review`, { decision: 'approve' })).status, 403);
  assert.equal((await t1.post(`/api/admin/exams/${id}/lock`)).status, 403);
  assert.equal((await t1.post(`/api/admin/exams/${id}/publish`)).status, 403);
  assert.equal((await t1.get(`/api/admin/exams`)).status, 403);
});

test('review can send marks back; locking and publishing follow strict order', async () => {
  const id = await examAt('submitted', 'Quiz 3', ctx.subjects.ds, t1, [70, 80, 90]);
  assert.equal((await cell.post(`/api/admin/exams/${id}/lock`)).body.error.code, 'INVALID_TRANSITION', 'cannot skip review');
  assert.equal((await cell.post(`/api/admin/exams/${id}/review`, { decision: 'return' })).body.error.code, 'REASON_REQUIRED');
  assert.equal((await cell.post(`/api/admin/exams/${id}/review`, { decision: 'return', reason: 'Check student 2' })).status, 200);
  assert.equal((await M.Exam.findById(id)).status, 'marks_entry');
  await t1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([70, 82, 90]) });
  await t1.post(`/api/faculty/exams/${id}/submit`);
  assert.equal((await cell.post(`/api/admin/exams/${id}/review`, { decision: 'approve' })).status, 200);
  assert.equal((await cell.post(`/api/admin/exams/${id}/publish`)).body.error.code, 'INVALID_TRANSITION', 'must lock first');
  assert.equal((await cell.post(`/api/admin/exams/${id}/lock`)).status, 200);
  assert.equal((await t1.put(`/api/faculty/exams/${id}/marks`, { entries: entries([1, 1, 1]) })).status, 409, 'locked');
  const log = await M.AuditLog.distinct('action', { college: ctx.college._id });
  for (const a of ['marks.saved', 'marks.submitted', 'marks.returned', 'marks.reviewed', 'results.locked']) assert.ok(log.includes(a), a);
});

test('only published results are visible to students; marks entered or locked stay private', async () => {
  const before = (await s1.get('/api/student/results')).body.data;
  assert.deepEqual(before.semesters, [], 'nothing is published yet');
  const dsId = await examAt('locked', 'Final DS', ctx.subjects.ds, t1, [80, 'AB', 95], { name: 'Final DS' });
  assert.deepEqual((await s1.get('/api/student/results')).body.data.semesters, [], 'locked is still private');
  assert.equal((await s1.get(`/api/student/report-card?sessionId=${ctx.academicSession._id}&semesterNumber=3`)).status, 404);

  assert.equal((await cell.post(`/api/admin/exams/${dsId}/publish`)).status, 200);
  const mine = (await s1.get('/api/student/results')).body.data;
  assert.equal(mine.semesters.length, 1);
  const row = mine.semesters[0].exams.find(e => e.exam === 'Final DS');
  assert.deepEqual([row.marks, row.grade, row.points, row.credits, row.passed], [80, 'B', 8, 4, true]);
  const theirs = (await s2.get('/api/student/results')).body.data.semesters[0].exams.find(e => e.exam === 'Final DS');
  assert.deepEqual([theirs.state, theirs.grade, theirs.passed, theirs.marks], ['absent', 'AB', false, null], 'absent students get the absent grade and fail');
  assert.ok(await M.Notification.exists({ user: ctx.students[0].user._id, type: 'result' }));
});

test('semester GPA and CGPA are credit weighted over the published subjects', async () => {
  const osId = await examAt('published', 'Final OS', ctx.subjects.os, t2, [40, 70, 20], { name: 'Final OS' });
  assert.ok(osId);
  const r = (await s1.get('/api/student/results')).body.data;
  const sem = r.semesters[0];
  // DS 80 -> B (8 pts, 4 credits); OS 40 -> F (0 pts, 2 credits)  => (8*4 + 0*2) / 6
  assert.equal(sem.gpa, 5.33);
  assert.equal(sem.credits, 6);
  assert.equal(sem.status, 'FAIL');
  assert.equal(r.cgpa, 5.33);
  const s3 = await harness.login(creds(ctx.college, ctx.students[2].user));
  const third = (await s3.get('/api/student/results')).body.data.semesters[0];
  assert.equal(third.gpa, 6.67, 'DS 95 -> A (10 points x 4), OS 20 -> F (0 x 2)');
});

test('changing the grading policy later does not alter results that were already published', async () => {
  await cell.put('/api/admin/exams/grading-policy', { name: 'Easier scale', bands: [{ minPercent: 0, grade: 'A', points: 10 }] });
  const sem = (await s1.get('/api/student/results')).body.data.semesters[0];
  assert.equal(sem.exams.find(e => e.exam === 'Final DS').grade, 'B', 'frozen at publication');
  assert.equal((await cell.get('/api/admin/exams/grading-policy')).body.data.version, 2);
  await cell.put('/api/admin/exams/grading-policy', { name: 'University scale', bands: BANDS });
});

test('published results are never edited silently: reopen needs a permission and a reason, and is audited', async () => {
  const list = (await cell.get('/api/admin/exams?status=published')).body.data;
  const ds = list.find(e => e.name === 'Final DS');
  assert.equal((await t1.post(`/api/admin/exams/${ds._id}/reopen`, { reason: 'typo fix please' })).status, 403);
  assert.equal((await cell.post(`/api/admin/exams/${ds._id}/reopen`, {})).status, 400);
  const reopened = await cell.post(`/api/admin/exams/${ds._id}/reopen`, { reason: 'Re-evaluation of student 1' });
  assert.equal(reopened.body.data.status, 'marks_entry');
  assert.equal(reopened.body.data.revision, 2);

  const semDuring = (await s1.get('/api/student/results')).body.data.semesters[0];
  assert.equal(semDuring.exams.some(e => e.exam === 'Final DS'), false, 'a reopened result is hidden until republished');

  assert.equal((await t1.put(`/api/faculty/exams/${ds._id}/marks`, { entries: entries([85, 'AB', 95]) })).body.error.code, 'REASON_REQUIRED');
  assert.equal((await t1.put(`/api/faculty/exams/${ds._id}/marks`, { entries: entries([85, 'AB', 95]), reason: 'Re-evaluation increased marks' })).status, 200);
  await t1.post(`/api/faculty/exams/${ds._id}/submit`);
  await cell.post(`/api/admin/exams/${ds._id}/review`, { decision: 'approve' });
  await cell.post(`/api/admin/exams/${ds._id}/lock`);
  assert.equal((await cell.post(`/api/admin/exams/${ds._id}/publish`)).status, 200);

  const now = (await s1.get('/api/student/results')).body.data.semesters[0];
  assert.equal(now.exams.find(e => e.exam === 'Final DS').marks, 85);
  const row = await M.MarksEntry.findOne({ exam: ds._id, student: ctx.students[0].profile._id });
  assert.deepEqual(row.history.map(h => h.marks), [80, 85], 'the original mark is still on record');
  assert.equal(row.history[1].reason, 'Re-evaluation increased marks');
  assert.equal(await M.Notification.countDocuments({ user: ctx.students[0].user._id, type: 'result', 'data.examId': String(ds._id) }), 2, 'students are told again after a republish');
  assert.ok((await M.AuditLog.distinct('action')).includes('results.reopened'));
});

test('report cards: PDF from published results only, own student only, verifiable', async () => {
  const q = `sessionId=${ctx.academicSession._id}&semesterNumber=3`;
  const pdf = await s1.get(`/api/student/report-card?${q}`).buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
  assert.equal((await s1.get(`/api/student/report-card?sessionId=${ctx.academicSession._id}&semesterNumber=7`)).status, 404);
  assert.equal((await s1.get('/api/student/report-card')).status, 400);

  const results = require('../../src/services/resultService');
  const data = await results.reportCardData({ studentId: ctx.students[0].profile._id, sessionId: ctx.academicSession._id, semesterNumber: 3 });
  assert.match(data.code, /^[0-9A-F]{12}$/);
  const verify = c => cell.get(`/api/admin/exams/verify?studentId=${ctx.students[0].profile._id}&sessionId=${ctx.academicSession._id}&semesterNumber=3&code=${c}`);
  assert.equal((await verify(data.code)).body.data.genuine, true);
  assert.equal((await verify('AAAAAAAAAAAA')).body.data.genuine, false);

  const adminCopy = await cell.get(`/api/admin/exams/report-card/${ctx.students[0].profile._id}?${q}`);
  assert.equal(adminCopy.status, 200);
  assert.equal((await t1.get(`/api/admin/exams/report-card/${ctx.students[0].profile._id}?${q}`)).status, 403);
});

test('roles without results access (and a HOD without departments) cannot read results or report cards', async () => {
  const lib = await makeStaff('hod', 'hodx@exam1.edu');   // a HOD with no departments assigned sees nothing
  const clerk = await makeStaff('accounts_clerk', 'clerk@exam1.edu');
  const q = `sessionId=${ctx.academicSession._id}&semesterNumber=3`;
  for (const agent of [lib, clerk]) {
    assert.equal((await agent.get(`/api/admin/exams/report-card/${ctx.students[0].profile._id}?${q}`)).status, 403);
    assert.equal((await agent.get('/api/admin/exams')).status, 403);
  }
  assert.equal((await cell.get('/api/admin/exams')).status, 200);
});
