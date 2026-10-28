const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, PASSWORD } = require('../helpers/fixtures');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');

let ctx; let M; let admin; let teacher; let s0; let s1; let parent; let parent2; let parentUser; let semester = 0; let assignment;
const id = x => String(x._id || x);
const stu = i => id(ctx.students[i].profile);
const FEE = 800_000;

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'PAR1', students: 3 });
  admin = await harness.login(creds(ctx.college, ctx.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  s0 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s1 = await harness.login(creds(ctx.college, ctx.students[1].user));
});
after(async () => { removeFakeProviders(); await harness.stop(); });

async function makeParent(email, studentIdx, over = {}) {
  const res = await admin.post('/api/admin/mentoring/parents', { name: `Parent ${email}`, email, password: PASSWORD, studentId: stu(studentIdx), relationship: 'mother', verificationNote: 'ID checked at the office', ...over });
  if (over.expect) return res;
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await M.User.updateOne({ email }, { $set: { mustChangePassword: false } });
  return harness.login({ collegeCode: ctx.college.code, email, password: PASSWORD });
}

async function publishedExam(name, studentIdx, marks, status) {
  const exam = await M.Exam.create({ college: ctx.college._id, name, type: 'internal', academicSession: ctx.academicSession._id, semesterNumber: 3, section: ctx.section._id, subject: ctx.subjects.ds._id, date: '2026-03-01', maxMarks: 100, passMarks: 40, status });
  const final = status === 'published' ? { state: 'pass', percent: marks, grade: 'A', points: 9, passed: true, revision: 1, at: new Date() } : undefined;
  await M.MarksEntry.create({ college: ctx.college._id, exam: exam._id, student: ctx.students[studentIdx].profile._id, marks, ...(final ? { final } : {}) });
  return exam;
}

test('a parent account needs a recorded verification and is linked to a specific student by the institution', async () => {
  const body = { name: 'Parent One', email: 'parent1@par1.edu', password: PASSWORD, studentId: stu(0), relationship: 'mother' };
  assert.equal((await admin.post('/api/admin/mentoring/parents', body)).status, 400, 'a verification note is mandatory');
  assert.equal((await teacher.post('/api/admin/mentoring/parents', { ...body, verificationNote: 'ID checked' })).status, 403, 'only the Administrator links parents');
  assert.equal((await admin.post('/api/admin/mentoring/parents', { ...body, studentId: String(other()), verificationNote: 'ID checked' })).status, 400, 'a student outside this college cannot be linked');
  parent = await makeParent('parent1@par1.edu', 0);
  parentUser = await M.User.findOne({ email: 'parent1@par1.edu' });
  assert.equal(parentUser.role, 'parent');
  assert.equal((await admin.post('/api/admin/mentoring/parents', { ...body, verificationNote: 'again' })).status, 409, 'duplicate e-mail');
  assert.ok(await M.AuditLog.findOne({ action: 'parent.linked' }));
  parent2 = await makeParent('parent2@par1.edu', 1);
});
function other() { return '64b7f0f0f0f0f0f0f0f0f0f0'; }

test('a parent sees only linked children and only PUBLISHED marks', async () => {
  const kids = (await parent.get('/api/parent/children')).body.data;
  assert.deepEqual(kids.map(k => k.rollNo), [ctx.students[0].profile.rollNo]);
  await publishedExam('Published Test', 0, 88, 'published');
  await publishedExam('Draft Test', 0, 12, 'marks_entry');
  await publishedExam('Sibling Test', 1, 77, 'published');
  const res = (await parent.get(`/api/parent/children/${stu(0)}/results`)).body.data;
  const exams = res.semesters.flatMap(s => s.exams);
  assert.deepEqual(exams.map(e => e.exam), ['Published Test'], 'drafts and unpublished entries never appear');
  assert.ok(!JSON.stringify(res).includes('Sibling'));
  assert.ok(await M.AuditLog.findOne({ action: 'parent.viewed', actor: parentUser._id }));
});

test('a parent cannot reach an unlinked student, enumerate ids or use a forged id', async () => {
  for (const sid of [stu(1), stu(2), '64b7f0f0f0f0f0f0f0f0f0f0', 'not-an-id']) {
    for (const area of ['results', 'fees/summary', 'fees/history', 'fees/refunds']) {
      assert.equal((await parent.get(`/api/parent/children/${sid}/${area}`)).status, 404, `${area} of ${sid}`);
    }
  }
  assert.equal((await parent2.get(`/api/parent/children/${stu(0)}/results`)).status, 404, 'another parent\'s child');
  assert.equal((await parent.post(`/api/parent/children/${stu(1)}/fees/orders`, { assignmentId: '64b7f0f0f0f0f0f0f0f0f0f0' })).status, 404);
  assert.deepEqual((await parent2.get('/api/parent/children')).body.data.map(k => k.rollNo), [ctx.students[1].profile.rollNo]);
});

test('every module except linked-child marks and fees is closed to parents, by direct URL too', async () => {
  const urls = ['/api/student/attendance', '/api/student/duty-leaves', '/api/student/assignments', '/api/student/results', '/api/student/dashboard', '/api/fees/summary',
    '/api/faculty/subjects', '/api/duty-leaves/review', '/api/duty-leaves/unassigned', `/api/mentor/students/${stu(0)}/notes`, '/api/mentor/attendance-watch',
    '/api/admin/students', '/api/admin/settings', '/api/admin/audit-log', '/api/admin/system/jobs', '/api/admin/data/export/students', '/api/admin/data/export/marks',
    '/api/admin/fees/structures', '/api/admin/exams', '/api/admin/library/books', '/api/admin/attendance/report', '/api/admin/analytics/overview', '/api/timetable'];
  for (const url of urls) assert.ok([401, 403].includes((await parent.get(url)).status), `${url} must be refused`);
  for (const [m, url] of [['post', '/api/student/duty-leaves'], ['post', '/api/admin/fees/structures'], ['post', '/api/admin/data/imports/marks/preview'], ['put', `/api/faculty/exams/x/marks`]]) {
    assert.ok([401, 403, 404].includes((await parent[m](url, {})).status), `${m} ${url}`);
  }
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/attendance`)).status, 404, 'there is no attendance route for parents');
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/leave`)).status, 404);
  assert.equal((await s0.get('/api/parent/children')).status, 403, 'students cannot use the parent portal');
});

async function createFee() {
  semester += 1;
  const s = await admin.post('/api/admin/fees/structures', { course: 'B.Tech', specialization: 'CSE', academicSessionId: id(ctx.academicSession), semesterNumber: semester, components: [{ name: 'Tuition fee', kind: 'tuition', amountPaise: FEE }], dueDate: '2099-01-01' });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  await admin.post('/api/admin/fees/assign', { structureId: s.body.data.id || s.body.data._id, studentIds: [stu(0), stu(1)] });
  return M.FeeAssignment.findOne({ student: ctx.students[0].profile._id, semesterNumber: semester });
}

test('a parent views and pays ONLY the linked child\'s fee through the trusted payment pipeline', async () => {
  assignment = await createFee();
  const summary = (await parent.get(`/api/parent/children/${stu(0)}/fees/summary`)).body.data;
  assert.equal(summary.student.rollNo, ctx.students[0].profile.rollNo);
  assert.equal(summary.student.name, 'Student 1', 'the child\'s name, not the parent\'s');
  assert.equal(summary.totals.outstandingPaise, FEE);

  // the child's fee cannot be paid through another child's URL, nor can the sibling's fee through this one
  const siblingFee = await M.FeeAssignment.findOne({ student: ctx.students[1].profile._id, semesterNumber: semester });
  assert.notEqual((await parent.post(`/api/parent/children/${stu(0)}/fees/orders`, { assignmentId: id(siblingFee) })).status, 201, 'a fee of another student is not payable here');
  assert.equal((await parent2.post(`/api/parent/children/${stu(0)}/fees/orders`, { assignmentId: id(assignment) })).status, 404);

  const order = await parent.post(`/api/parent/children/${stu(0)}/fees/orders`, { assignmentId: id(assignment) });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const orderId = order.body.data.checkout.orderId;
  const base = `/api/parent/children/${stu(0)}/fees/orders/${orderId}`;
  assert.ok([400, 404].includes((await parent2.post(`/api/parent/children/${stu(1)}/fees/orders/${orderId}/verify`, { paymentId: 'x', signature: 'y' })).status), 'another family cannot verify this order');
  // a forged "success" cannot be confirmed without the gateway's signature
  const forged = await parent.post(`${base}/verify`, { paymentId: 'pay_forged', signature: 'deadbeef' });
  assert.notEqual(forged.status, 200);
  assert.equal((await M.FeeAssignment.findById(assignment._id)).paidPaise, 0, 'nothing is credited without verification');

  const sim = (await parent.post(`${base}/simulate`, { outcome: 'success' })).body.data;
  const verified = await parent.post(`${base}/verify`, { paymentId: sim.paymentId, signature: sim.signature });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const payment = await M.Payment.findOne({ providerOrderId: orderId });
  assert.equal(String(payment.student), stu(0), 'the payment belongs to the child');
  assert.equal(payment.status, 'success');
  assert.equal((await M.FeeAssignment.findById(assignment._id)).paidPaise, FEE);
  assert.equal((await M.FeeAssignment.findById(siblingFee._id)).paidPaise, 0, 'the sibling\'s fee is untouched');

  // receipts: the child's own only
  const hist = (await parent.get(`/api/parent/children/${stu(0)}/fees/history`)).body.data.transactions;
  const paid = hist.find(t => t.status === 'success' && t.receiptId);
  assert.ok(paid);
  const pdf = await parent.get(`/api/parent/children/${stu(0)}/fees/receipts/${paid.receiptId}/pdf`).buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
  assert.equal((await parent2.get(`/api/parent/children/${stu(1)}/fees/receipts/${paid.receiptId}/pdf`)).status, 404, 'another child\'s receipt is not downloadable');
  assert.equal((await parent.get(`/api/fees/receipts/${paid.receiptId}/pdf`)).status, 403, 'the student route is closed to parents');
});

test('college visibility switches and revocation take effect immediately', async () => {
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.parentVisibility.results': false, 'settings.parentVisibility.fees': false } });
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/results`)).body.error.code, 'NOT_SHARED');
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/fees/summary`)).body.error.code, 'NOT_SHARED');
  await M.College.updateOne({ _id: ctx.college._id }, { $set: { 'settings.parentVisibility.results': true, 'settings.parentVisibility.fees': true } });
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/results`)).status, 200);

  const link = await M.ParentLink.findOne({ parent: parentUser._id });
  assert.equal((await teacher.post(`/api/admin/mentoring/parents/links/${link._id}/revoke`, {})).status, 403);
  assert.equal((await admin.post(`/api/admin/mentoring/parents/links/${link._id}/revoke`, { reason: 'Custody change' })).status, 200);
  assert.equal((await parent.get(`/api/parent/children/${stu(0)}/results`)).status, 404);
  assert.deepEqual((await parent.get('/api/parent/children')).body.data, []);
  assert.ok(await M.AuditLog.findOne({ action: 'parent.revoked' }));
});

test('the Parent role has no console permissions and the HOD cannot manage or read parent contact data', async () => {
  const me = (await parent2.get('/api/auth/me')).body.data.user;
  assert.deepEqual(me.permissions, []);
  const res = await admin.post('/api/admin/access/staff', { name: 'H', email: 'hodp@par1.edu', password: PASSWORD, role: 'hod' });
  assert.equal(res.status, 201);
  await M.User.updateOne({ email: 'hodp@par1.edu' }, { $set: { mustChangePassword: false } });
  const hod = await harness.login({ collegeCode: ctx.college.code, email: 'hodp@par1.edu', password: PASSWORD });
  assert.equal((await hod.get('/api/admin/mentoring/parents')).status, 403);
  assert.equal((await hod.post('/api/admin/mentoring/parents', { name: 'x', email: 'x@par1.edu', password: PASSWORD, studentId: stu(0), verificationNote: 'xxxxx' })).status, 403);
  assert.equal((await hod.get('/api/parent/children')).status, 403);
});
