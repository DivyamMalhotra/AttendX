const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds } = require('../helpers/fixtures');
const { multipart, file, PDF, PNG, DOCX, countFiles } = require('../helpers/multipart');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let hod; let t1; let t2; let s1; let s2; let other; let svc;
const inHours = h => new Date(Date.now() + h * 3600000).toISOString();

const create = (agent, over = {}, files = [file('brief.pdf')]) => multipart(agent, 'post', '/api/faculty/assignments', {
  subjectId: String(ctx.subjects.ds._id), title: 'Linked lists', instructions: 'Implement a doubly linked list.', deadline: inHours(48), maxMarks: 20, ...over
}, files);
const submit = (agent, id, files = [file()]) => multipart(agent, 'post', `/api/student/assignments/${id}/submit`, { note: 'done' }, files);
const dbAssignment = id => M.Assignment.findById(id);

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  svc = require('../../src/services/assignmentService');
  ctx = await seedCollege(M, { code: 'ASG1', students: 3 });
  other = await seedCollege(M, { code: 'ASG2', students: 1 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  t2 = await harness.login(creds(ctx.college, ctx.teacher2));
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('only the subject\'s teacher creates assignments; students cannot', async () => {
  assert.equal((await create(t2)).status, 403, 'teacher of another subject');
  assert.equal((await create(s1)).status, 403, 'student');
  const ok = await create(t1);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.data.status, 'draft');
  assert.equal(ok.body.data.attachments.length, 1);
  assert.match(ok.body.data.attachments[0].storedName, /^[a-f0-9]{32}\.pdf$/);
  assert.equal((await create(t1, { deadline: 'not a date' })).status, 400);
  assert.equal((await create(t1, { publishAt: inHours(10), deadline: inHours(5) })).body.error.code, 'INVALID_DEADLINE');
});

test('uploads are validated by type, real content and size; rejected files leave nothing on disk', async () => {
  const before = countFiles('assignments');
  assert.equal((await create(t1, {}, [file('run.exe', Buffer.from('MZ'), 'application/x-msdownload')])).body.error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal((await create(t1, {}, [file('fake.pdf', Buffer.from('this is not a pdf'), 'application/pdf')])).body.error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal((await create(t1, {}, [file('shell.png', Buffer.from('<?php system($_GET[1]);'), 'image/png')])).body.error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal((await create(t1, {}, [file('big.pdf', Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024)]))])).status, 413);
  assert.equal((await create(t1, { title: '' }, [file('ok.pdf')])).status, 400, 'invalid fields discard the already-saved file too');
  assert.equal(countFiles('assignments'), before, 'nothing left behind');
  assert.equal((await create(t1, { title: 'Docx ok' }, [file('a.docx', DOCX, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), file('b.png', PNG, 'image/png')])).status, 201);
});

test('drafts are private; publishing shows the assignment to the class once and notifies each student once', async () => {
  const a = (await create(t1, { title: 'Publish test' })).body.data;
  assert.equal((await s1.get('/api/student/assignments')).body.data.some(x => x.id === a._id), false);
  assert.equal((await s1.get(`/api/files/assignment/${a._id}/0`)).status, 403, 'draft attachments are private');

  assert.equal((await t2.post(`/api/faculty/assignments/${a._id}/publish`)).status, 403);
  assert.equal((await t1.post(`/api/faculty/assignments/${a._id}/publish`)).status, 200);
  await t1.post(`/api/faculty/assignments/${a._id}/publish`);
  const seen = (await s1.get('/api/student/assignments')).body.data.find(x => x.id === a._id);
  assert.equal(seen.title, 'Publish test');
  assert.equal(seen.submission, null);
  assert.equal(await M.Notification.countDocuments({ user: ctx.students[0].user._id, 'data.assignmentId': a._id }), 1, 'republishing never re-notifies');
});

test('deadline, late and resubmission policies are enforced on the server clock', async () => {
  const mk = async over => {
    const a = (await create(t1, over)).body.data;
    await t1.post(`/api/faculty/assignments/${a._id}/publish`);
    return a._id;
  };
  // passed deadline, late not allowed
  const closedId = await mk({ title: 'Strict' });
  await M.Assignment.updateOne({ _id: closedId }, { $set: { deadline: new Date(Date.now() - 3600000) } });
  const strict = await submit(s1, closedId);
  assert.equal(strict.status, 409);
  assert.equal(strict.body.error.code, 'DEADLINE_PASSED');

  // late allowed -> accepted and flagged
  const lateId = await mk({ title: 'Lenient', allowLate: 'true' });
  await M.Assignment.updateOne({ _id: lateId }, { $set: { deadline: new Date(Date.now() - 3600000) } });
  const late = await submit(s1, lateId);
  assert.equal(late.status, 201);
  assert.equal(late.body.data.late, true);

  // on time, resubmission allowed -> attempt 2, old file removed
  const okId = await mk({ title: 'Resubmit ok' });
  const first = await submit(s1, okId);
  assert.equal(first.body.data.late, false);
  const filesBefore = countFiles('submissions');
  const second = await submit(s1, okId, [file('v2.png', PNG, 'image/png')]);
  assert.equal(second.status, 201);
  assert.equal(second.body.data.attempt, 2);
  assert.equal(await M.AssignmentSubmission.countDocuments({ assignment: okId, student: ctx.students[0].profile._id }), 1, 'one record per student');
  assert.equal(countFiles('submissions'), filesBefore, 'the replaced file was deleted');

  // resubmission not allowed
  const noId = await mk({ title: 'One shot', allowResubmit: 'false' });
  assert.equal((await submit(s1, noId)).status, 201);
  assert.equal((await submit(s1, noId)).body.error.code, 'RESUBMIT_NOT_ALLOWED');

  // must attach a file; validated types only; wrong class cannot submit
  assert.equal((await submit(s2, okId, [])).body.error.code, 'FILE_REQUIRED');
  assert.equal((await submit(s2, okId, [file('x.exe', Buffer.from('MZ'), 'application/x-msdownload')])).status, 400);
  const outsider = await harness.login(creds(other.college, other.students[0].user));
  assert.equal((await submit(outsider, okId)).status, 404);

  // draft/closed
  const draft = (await create(t1, { title: 'Hidden' })).body.data;
  assert.equal((await submit(s1, draft._id)).status, 404, 'drafts cannot be submitted to');
  await t1.post(`/api/faculty/assignments/${okId}/close`);
  assert.equal((await submit(s2, okId)).body.error.code, 'ASSIGNMENT_CLOSED');
});

test('submitted work is private: only the owner and the subject teacher can download it', async () => {
  const a = (await create(t1, { title: 'Privacy' })).body.data;
  await t1.post(`/api/faculty/assignments/${a._id}/publish`);
  await submit(s1, a._id);
  const sub = await M.AssignmentSubmission.findOne({ assignment: a._id });
  const url = `/api/files/submission/${sub._id}/0`;
  const own = await s1.get(url);
  assert.equal(own.status, 200);
  assert.equal(own.headers['content-type'], 'application/pdf');
  assert.match(own.headers['content-disposition'], /attachment/);
  assert.equal(own.headers['x-content-type-options'], 'nosniff');
  assert.equal((await s2.get(url)).status, 403, 'another student');
  assert.equal((await t2.get(url)).status, 403, 'teacher of another subject');
  assert.equal((await t1.get(url)).status, 200);
  assert.equal((await hod.get(url)).status, 200);
  assert.equal((await harness.supertest().get(url)).status, 401);
  const outsider = await harness.login(creds(other.college, other.students[0].user));
  assert.equal((await outsider.get(url)).status, 404, 'another college cannot even tell it exists');
  assert.equal((await harness.supertest().get(`/uploads/submissions/${sub.files[0].storedName}`)).status, 404, 'files are not in the web root');
  assert.equal((await s1.get(`/api/files/submission/${sub._id}/9`)).status, 404);
  const sec = await M.Section.create({ college: ctx.college._id, name: 'Other', nameKey: 'other', sem: 'Sem 3', semesterNumber: 3 });
  const { profile, user } = await require('../../src/services/studentService').registerStudent(ctx.hod, ctx.college._id, { name: 'Elsewhere', email: 'else@asg1.edu', password: 'Passw0rd1', rollNo: 'ASG1900', sectionId: sec._id });
  await M.User.updateOne({ _id: user._id }, { $set: { mustChangePassword: false } });
  const far = await harness.login({ collegeCode: ctx.college.code, email: 'else@asg1.edu', password: 'Passw0rd1' });
  assert.equal((await far.get(`/api/files/assignment/${a._id}/0`)).status, 403, 'a student of another section cannot download the attachment');
  assert.ok(profile);
});

test('grading: bounded marks, hidden until released, history kept, only the teacher can grade', async () => {
  const a = (await create(t1, { title: 'Grading', maxMarks: 20 })).body.data;
  await t1.post(`/api/faculty/assignments/${a._id}/publish`);
  await submit(s1, a._id);
  await submit(s2, a._id);
  const sid = String(ctx.students[0].profile._id);

  assert.equal((await t2.put(`/api/faculty/assignments/${a._id}/submissions/${sid}/grade`, { marks: 10 })).status, 403);
  assert.equal((await s1.put(`/api/faculty/assignments/${a._id}/submissions/${sid}/grade`, { marks: 20 })).status, 403);
  assert.equal((await t1.put(`/api/faculty/assignments/${a._id}/submissions/${sid}/grade`, { marks: 21 })).body.error.code, 'INVALID_MARKS');
  assert.equal((await t1.put(`/api/faculty/assignments/${a._id}/submissions/${sid}/grade`, { marks: -1 })).status, 400);
  assert.equal((await t1.put(`/api/faculty/assignments/${a._id}/submissions/${sid}/grade`, { marks: 15, feedback: 'Good, handle null nodes.' })).status, 200);
  await t1.put(`/api/faculty/assignments/${a._id}/submissions/${sid}/grade`, { marks: 16, feedback: 'Good, handle null nodes.' });

  const before = (await s1.get('/api/student/assignments')).body.data.find(x => x.id === a._id).submission;
  assert.equal(before.marks, null, 'marks are private until released');
  assert.equal(before.feedback, '');
  const sheet = (await t1.get(`/api/faculty/assignments/${a._id}/submissions`)).body.data;
  assert.equal(sheet.rows.find(r => r.studentId === sid).submission.marks, 16);
  assert.equal(sheet.rows.find(r => r.studentId === String(ctx.students[2].profile._id)).submission, null, 'missing work is listed');

  assert.equal((await t1.post(`/api/faculty/assignments/${a._id}/release`)).body.data.released, 1);
  assert.equal((await t1.post(`/api/faculty/assignments/${a._id}/release`)).body.data.released, 0, 'releasing twice does nothing');
  const after = (await s1.get('/api/student/assignments')).body.data.find(x => x.id === a._id).submission;
  assert.deepEqual([after.marks, after.status, after.feedback], [16, 'graded', 'Good, handle null nodes.']);
  assert.equal((await s2.get('/api/student/assignments')).body.data.find(x => x.id === a._id).submission.marks, null, 'the other student\'s ungraded work stays private');
  assert.equal(await M.Notification.countDocuments({ user: ctx.students[0].user._id, title: /graded/ }), 1);

  const sub = await M.AssignmentSubmission.findOne({ assignment: a._id, student: sid });
  assert.deepEqual(sub.history.map(h => h.action), ['submitted', 'grade', 'grade']);
  assert.equal((await submit(s1, a._id)).body.error.code, 'RESUBMIT_NOT_ALLOWED', 'graded work is final');

  // return for revision re-opens submission
  await t1.put(`/api/faculty/assignments/${a._id}/submissions/${String(ctx.students[1].profile._id)}/grade`, { action: 'return', feedback: 'Please add tests.' });
  const returned = (await s2.get('/api/student/assignments')).body.data.find(x => x.id === a._id).submission;
  assert.deepEqual([returned.status, returned.feedback], ['returned', 'Please add tests.']);
  assert.equal((await submit(s2, a._id)).status, 201, 'a returned submission may be redone');
  assert.ok((await M.AuditLog.distinct('action')).includes('submission.graded'));
});

test('deadline reminders go to students who have not submitted, once', async () => {
  const a = (await create(t1, { title: 'Soon', deadline: inHours(10) })).body.data;
  await t1.post(`/api/faculty/assignments/${a._id}/publish`);
  await submit(s1, a._id);
  const college = await M.College.findById(ctx.college._id);
  const first = await svc.remindDueSoon(college);
  const again = await svc.remindDueSoon(college);
  assert.equal(first, 2, 'student 1 submitted, the other two get a reminder');
  assert.equal(again, 0);
  assert.equal(await M.Notification.countDocuments({ user: ctx.students[0].user._id, title: /due soon/ }), 0);
});

test('study material: uploaded by the subject teacher, visible only to the class, removable', async () => {
  const m = (path, over = {}, files = [file('notes.pdf')]) => multipart(t1, 'post', path, { subjectId: String(ctx.subjects.ds._id), title: 'Trees notes', topic: 'Trees', resourceType: 'lecture_notes', ...over }, files);
  assert.equal((await multipart(t2, 'post', '/api/faculty/materials', { subjectId: String(ctx.subjects.ds._id), title: 'Nope' }, [file()])).status, 403);
  assert.equal((await m('/api/faculty/materials', {}, [])).body.error.code, 'FILE_REQUIRED');
  const up = await m('/api/faculty/materials');
  assert.equal(up.status, 201);
  const list = (await s1.get('/api/student/materials')).body.data;
  assert.equal(list.length, 1);
  assert.equal(list[0].topic, 'Trees');
  assert.equal((await s1.get(`/api/files/material/${list[0].id}`)).status, 200);
  const outsider = await harness.login(creds(other.college, other.students[0].user));
  assert.equal((await outsider.get('/api/student/materials')).body.data.length, 0);
  assert.equal((await outsider.get(`/api/files/material/${list[0].id}`)).status, 404);
  const sizeBefore = countFiles('materials');
  assert.equal((await t2.del(`/api/faculty/materials/${list[0].id}`)).status, 403);
  assert.equal((await t1.del(`/api/faculty/materials/${list[0].id}`)).status, 200);
  assert.equal(countFiles('materials'), sizeBefore - 1);
  assert.equal((await s1.get('/api/student/materials')).body.data.length, 0);
});
