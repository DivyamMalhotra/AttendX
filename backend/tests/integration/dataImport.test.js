const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { multipart } = require('../helpers/multipart');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');
const { todayISO } = require('../../src/utils/dates');
const { parseCsv, isFormulaLike } = require('../../src/utils/csvParse');

let ctx; let M; let hod; let teacher; let registrar; let librarian; let examCell; let box;
const id = x => String(x._id || x);
const today = todayISO('Asia/Kolkata');

const csvFile = text => [{ buf: Buffer.from(text, 'utf8'), name: 'upload.csv', type: 'text/csv', field: 'file' }];
const upload = (agent, kind, text, fields = {}) => multipart(agent, 'post', `/api/admin/data/imports/${kind}/preview`, fields, csvFile(text));
const confirm = (agent, batchId, body = {}) => agent.post(`/api/admin/data/imports/${batchId}/confirm`, body);

before(async () => {
  const { models } = await harness.start();
  M = models;
  box = installFakeProviders();
  ctx = await seedCollege(M, { code: 'IMP1', students: 2 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  teacher = await harness.login(creds(ctx.college, ctx.teacher));
  registrar = hod;   // the Administrator runs student imports
  librarian = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'lib@imp1.edu' });
  examCell = await makeStaff({ harness, hod, M, ctx, roleKey: 'exam_cell', email: 'cell@imp1.edu' });
});
after(async () => { removeFakeProviders(); await harness.stop(); });

test('the CSV reader handles quotes, embedded commas and line breaks, BOM and mixed line endings', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\n\n1,2,3');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2'], ['1', '2', '3']]);
  assert.throws(() => parseCsv('a,"unclosed'), /unclosed/);
  assert.equal(isFormulaLike('=1+1'), true);
  assert.equal(isFormulaLike('@SUM(A1)'), true);
  assert.equal(isFormulaLike('-5'), false, 'plain negative numbers are numbers, not formulas');
  assert.equal(isFormulaLike('Asha'), false);
});

test('imports need imports.manage plus the permission for that kind of data', async () => {
  const csv = 'name,email,rollno,section\r\nA B,ab@x.edu,IMP2026001,CS-B\r\n';
  assert.equal((await upload(teacher, 'students', csv)).status, 403);
  assert.equal((await upload(librarian, 'students', csv)).status, 403, 'an accounts clerk has neither permission');
  assert.equal((await upload(examCell, 'students', csv)).status, 403, 'imports.manage alone is not enough for students');
  assert.equal((await upload(hod, 'books', 'title\r\nBook\r\n')).status, 400, 'library data is no longer part of the import page');
  const tpl = await registrar.get('/api/admin/data/imports/templates/students');
  assert.equal(tpl.status, 200);
  assert.match(tpl.text, /^name,email,rollno,section/);
  assert.equal((await registrar.get('/api/admin/data/imports/templates/nothing')).status, 400);
});

test('upload validates everything but writes nothing until confirmed', async () => {
  const before = await M.StudentProfile.countDocuments();
  const csv = [
    'Name,E-mail,Roll No,Section,Phone,Admission Year',
    'Asha Verma,asha@imp1.edu,IMP2026001,CS-B,9876543210,2026',
    'Ravi Kumar,ravi@imp1.edu,imp2026002,CS-B,,2026',
    'Dup Email,s1@imp1.edu,IMP2026003,CS-B,,',
    'Dup Roll,dup@imp1.edu,IMP2026001,CS-B,,',
    '=cmd|\' /C calc\'!A0,evil@imp1.edu,IMP2026004,CS-B,,',
    'No Section,ns@imp1.edu,IMP2026005,Nowhere,,',
    'Bad Roll,br@imp1.edu,!!,CS-B,,',
    'Bad Year,by@imp1.edu,IMP2026006,CS-B,,1850'
  ].join('\r\n');
  const res = await upload(registrar, 'students', csv);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body.data;
  assert.deepEqual([p.totals.rows, p.totals.valid, p.totals.invalid], [8, 2, 6]);
  assert.equal(p.status, 'previewed');
  const msgs = Object.fromEntries(p.errors.map(e => [e.line, e.errors.join(' ')]));
  assert.match(msgs[4], /email already exists/);
  assert.match(msgs[5], /Duplicate of line 2|already exists/);
  assert.match(msgs[6], /must not start with/);
  assert.match(msgs[7], /Section not found/);
  assert.match(msgs[8], /Roll number/);
  assert.match(msgs[9], /4-digit year/);
  assert.equal(await M.StudentProfile.countDocuments(), before, 'preview created no students');
  assert.ok(!JSON.stringify(p).includes('password'));
  ctx.batch = p.id;
});

test('confirming with errors is refused unless invalid rows are skipped; valid rows are then created once', async () => {
  const refused = await confirm(registrar, ctx.batch);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'HAS_ERRORS');
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: 'IMP2026001' }), 0);

  const emailsBefore = box.emails.length;
  const results = await Promise.all([1, 2, 3].map(() => confirm(registrar, ctx.batch, { skipInvalid: true })));
  assert.equal(results.filter(r => r.status === 200).length, 1, 'simultaneous confirms apply the batch once');
  assert.ok(results.filter(r => r.status !== 200).every(r => r.status === 409));
  const done = results.find(r => r.status === 200).body.data;
  assert.equal(done.status, 'completed');
  assert.deepEqual([done.totals.ok, done.totals.failed], [2, 0]);
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: { $in: ['IMP2026001', 'IMP2026002'] } }), 2, 'roll numbers are normalised and created exactly once');

  const asha = await M.User.findOne({ email: 'asha@imp1.edu' }).select('+passwordHash');
  assert.equal(asha.mustChangePassword, true);
  assert.equal((await M.StudentProfile.findOne({ user: asha._id })).admissionYear, 2026);
  assert.equal(done.extras.welcomeRequested, 2);
  assert.equal(box.emails.length - emailsBefore, 2, 'each new student gets a set-your-password email');
  assert.ok(box.emails.slice(emailsBefore).every(m => /reset-password\.html#token=/.test(m.text || m.html || '')));

  const stored = JSON.stringify(await M.ImportBatch.findById(ctx.batch).lean());
  assert.ok(!/passw/i.test(stored.replace(/mustChangePassword/g, '')), 'no password is stored with the batch');
  assert.equal((await confirm(registrar, ctx.batch, { skipInvalid: true })).status, 409, 'a completed batch cannot be re-applied');
  assert.ok(await M.AuditLog.findOne({ action: 'import.completed' }));
});

test('previews expire, can be cancelled, and conflicts that appear after preview are reported per row', async () => {
  const csv = 'name,email,rollno,section\r\nLate Comer,late@imp1.edu,IMP2026010,CS-B\r\nRace One,race@imp1.edu,IMP2026011,CS-B\r\n';
  const a = (await upload(registrar, 'students', csv)).body.data;
  await M.ImportBatch.updateOne({ _id: a.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await confirm(registrar, a.id)).body.error.code, 'PREVIEW_EXPIRED');

  const b = (await upload(registrar, 'students', csv.replace(/IMP2026010/, 'IMP2026020').replace(/late@/, 'late2@').replace(/race@/, 'race2@').replace('IMP2026011', 'IMP2026021'))).body.data;
  assert.equal((await registrar.post(`/api/admin/data/imports/${b.id}/cancel`)).body.data.status, 'cancelled');
  assert.equal((await confirm(registrar, b.id)).status, 409);

  const c = (await upload(registrar, 'students', csv.replace(/IMP2026010/, 'IMP2026030').replace(/late@/, 'late3@').replace(/race@/, 'race3@').replace('IMP2026011', 'IMP2026031'))).body.data;
  // someone registers the same roll number between preview and confirm
  const studentService = require('../../src/services/studentService');
  await studentService.registerStudent(ctx.hod, ctx.college._id, { name: 'Sneaky', email: 'sneaky@imp1.edu', password: 'Passw0rd1', rollNo: 'IMP2026031', sectionId: ctx.section._id });
  const done = (await confirm(registrar, c.id)).body.data;
  assert.deepEqual([done.totals.ok, done.totals.failed], [1, 1]);
  assert.match(done.failures[0].message, /roll|exists|already/i);
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: 'IMP2026031' }), 1);
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: 'IMP2026030' }), 1);
});

test('an interrupted import resumes without redoing finished rows', async () => {
  const csv = 'name,email,rollno,section\r\nOne,one@imp1.edu,IMP2026701,CS-B\r\nTwo,two@imp1.edu,IMP2026702,CS-B\r\nThree,three@imp1.edu,IMP2026703,CS-B\r\n';
  const p = (await upload(hod, 'students', csv)).body;
  assert.equal(p.error?.code, undefined, JSON.stringify(p));
  const batchId = p.data.id;
  // simulate a crash after row 1: the row is marked done (and was created), the lease has run out
  await require('../../src/services/studentService').registerStudent(ctx.hod, ctx.college._id, { name: 'One', email: 'one@imp1.edu', password: 'Passw0rd1', rollNo: 'IMP2026701', sectionId: ctx.section._id });
  await M.ImportBatch.updateOne({ _id: batchId, 'rows.line': 2 }, { $set: { status: 'importing', leaseUntil: new Date(Date.now() - 1000), 'rows.$.state': 'ok' } });
  assert.equal((await confirm(hod, batchId)).status, 200);
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: 'IMP2026701' }), 1, 'row 1 was not repeated');
  assert.equal(await M.StudentProfile.countDocuments({ rollNo: { $in: ['IMP2026702', 'IMP2026703'] } }), 2);
  const final = await M.ImportBatch.findById(batchId);
  assert.deepEqual([final.status, final.totals.ok], ['completed', 3]);
});

test('library books are no longer importable and loans are no longer exportable from this page', async () => {
  assert.equal((await upload(hod, 'books', 'title,isbn,copies\r\nClean Code,9780132350884,2\r\n')).status, 400);
  assert.equal((await hod.get('/api/admin/data/imports/templates/books')).status, 400);
  assert.equal((await hod.get('/api/admin/data/export/loans')).status, 400);
  assert.equal((await librarian.get('/api/admin/data/export/loans')).status, 400, 'there is no loans export');
});

test('marks import validates against the exam, applies atomically and shows who may do it', async () => {
  const exam = await hod.post('/api/admin/exams', {
    name: 'Imported Test', type: 'internal', academicSessionId: id(ctx.academicSession), subjectId: id(ctx.subjects.ds), date: today,
    startTime: '09:00', endTime: '10:00', venue: 'Hall X', maxMarks: 50, passMarks: 20
  });
  assert.equal(exam.status, 201, JSON.stringify(exam.body));
  const examId = exam.body.data._id;
  assert.equal((await upload(hod, 'marks', 'rollno,marks\r\nX,1\r\n')).body.error.code, 'EXAM_REQUIRED');
  assert.equal((await upload(teacher, 'marks', 'rollno,marks\r\nX,1\r\n', { examId })).status, 403, 'teachers use their own marks sheet, not the bulk upload');
  assert.equal((await upload(librarian, 'marks', 'rollno,marks\r\nX,1\r\n', { examId })).status, 403);
  assert.equal((await upload(examCell, 'marks', 'rollno,marks\r\nX,1\r\n', { examId })).status, 201, 'the Exam Cell uploads marks');

  const r1 = ctx.students[0].profile.rollNo; const r2 = ctx.students[1].profile.rollNo;
  const bad = (await upload(hod, 'marks', `rollno,marks,absent\r\n${r1},75,\r\nNOPE,10,\r\n${r2},,yes\r\n`, { examId })).body.data;
  assert.deepEqual([bad.totals.valid, bad.totals.invalid], [1, 2]);
  assert.match(JSON.stringify(bad.errors), /0 to 50/);
  assert.match(JSON.stringify(bad.errors), /not in the examination/);

  const good = (await upload(examCell, 'marks', `Roll No,Marks,Absent,Remark\r\n${r1},42,,Good\r\n${r2},,AB,\r\n`, { examId })).body.data;
  assert.equal(good.totals.invalid, 0);
  const done = (await confirm(examCell, good.id)).body.data;
  assert.equal(done.status, 'completed');
  const saved = await M.MarksEntry.find({ exam: examId }).lean();
  assert.equal(saved.length, 2);
  assert.equal(saved.find(s => String(s.student) === id(ctx.students[0].profile)).marks, 42);
  assert.equal(saved.find(s => String(s.student) === id(ctx.students[1].profile)).absent, true);
  assert.equal((await M.Exam.findById(examId)).status, 'marks_entry');
  assert.ok(await M.AuditLog.findOne({ action: 'marks.saved' }));
});

test('exports need reports.export plus the data permission, are audited, and neutralise formulas', async () => {
  await M.User.updateOne({ email: 'asha@imp1.edu' }, { $set: { name: '=SUM(A1:A9)' } });
  assert.equal((await teacher.get('/api/admin/data/export/students')).status, 403);
  assert.equal((await (await harness.login(creds(ctx.college, ctx.students[0].user))).get('/api/admin/data/export/students')).status, 403, 'students cannot export');
  assert.equal((await hod.get('/api/admin/data/export/bogus')).status, 400);

  const res = await hod.get('/api/admin/data/export/students');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /Students-\d{4}-\d{2}-\d{2}\.csv/);
  assert.ok(res.text.startsWith('Roll no,Name,Email,Section'));
  assert.ok(res.text.includes("'=SUM(A1:A9)"));
  assert.ok(!/(^|,)=SUM/m.test(res.text));
  const audit = await M.AuditLog.findOne({ action: 'export.generated', entityId: 'students' });
  assert.ok(audit && audit.meta.rows >= 4);
  assert.equal((await hod.get('/api/admin/data/export/fees')).status, 200);
  assert.equal((await hod.get('/api/admin/data/export/payments')).status, 200);
});

test('Student Marks export: identifiers, escaping, no library or secret data, authorised roles only', async () => {
  const examId = (await M.Exam.findOne({ name: 'Imported Test' }))._id;
  await M.User.updateOne({ _id: ctx.students[0].user._id }, { $set: { name: 'Zoë "Z", O\'Neil =cmd' } });
  await M.MarksEntry.updateOne({ exam: examId, student: ctx.students[0].profile._id }, { $set: { remark: 'line1\nline2, "quoted"' } });

  const res = await examCell.get('/api/admin/data/export/marks');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv; charset=utf-8/);
  assert.match(res.headers['content-disposition'], /Student-Marks-\d{4}-\d{2}-\d{2}\.csv/);
  const rows = parseCsv(res.text.replace(/^﻿/, ''));
  const header = rows[0];
  for (const col of ['Roll no', 'Student name', 'Subject code', 'Subject', 'Exam', 'Exam date', 'Max marks', 'Marks', 'Absent']) assert.ok(header.includes(col), col);
  assert.ok(!/isbn|book|loan|password|hash|email/i.test(header.join(',')), 'no library data and no secrets');
  const col = name => header.indexOf(name);
  const mine = rows.slice(1).find(r => r[col('Roll no')] === ctx.students[0].profile.rollNo);
  assert.equal(mine[col('Marks')], '42');
  assert.equal(mine[col('Exam')], 'Imported Test');
  assert.equal(mine[col('Subject code')], 'CS201');
  assert.ok(mine[col('Student name')].startsWith('Zoë "Z"'), 'Unicode and quotes survive a round trip');
  assert.equal(mine[col('Remark')], 'line1\nline2, "quoted"');
  const absent = rows.slice(1).find(r => r[col('Roll no')] === ctx.students[1].profile.rollNo);
  assert.deepEqual([absent[col('Marks')], absent[col('Absent')]], ['', 'yes'], 'an absent student is not exported as zero');
  assert.equal(rows.length - 1, await M.MarksEntry.countDocuments(), 'no entry is silently dropped');

  await M.User.updateOne({ _id: ctx.students[1].user._id }, { $set: { name: '=HYPERLINK("http://x","y")' } });
  const again = (await hod.get('/api/admin/data/export/marks')).text;
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(again), 'formulas are neutralised');

  for (const agent of [teacher, librarian]) assert.equal((await agent.get('/api/admin/data/export/marks')).status, 403);
  assert.ok(await M.AuditLog.findOne({ action: 'export.generated', entityId: 'marks' }));
});
