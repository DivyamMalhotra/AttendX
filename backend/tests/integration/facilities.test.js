const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { todayISO, addDays } = require('../../src/utils/dates');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');
const libraryService = require('../../src/services/libraryService');

let ctx; let M; let hod; let t1; let s1; let s2; let librarian; let clerk;
const today = todayISO('Asia/Kolkata');
const id = x => String(x._id || x);
const stu = i => id(ctx.students[i].profile);

before(async () => {
  const { models } = await harness.start();
  M = models;
  installFakeProviders();
  ctx = await seedCollege(M, { code: 'FAC1', students: 4 });
  hod = await harness.login(creds(ctx.college, ctx.hod));
  t1 = await harness.login(creds(ctx.college, ctx.teacher));
  s1 = await harness.login(creds(ctx.college, ctx.students[0].user));
  s2 = await harness.login(creds(ctx.college, ctx.students[1].user));
  librarian = hod;   // the library desk is run by the Administrator (there is no Librarian role)
  clerk = await makeStaff({ harness, hod, M, ctx, roleKey: 'accounts_clerk', email: 'clerk@fac1.edu' });
});
after(async () => { removeFakeProviders(); await harness.stop(); });

const addBook = (body = {}) => librarian.post('/api/admin/library/books', { title: 'Algorithms', author: 'CLRS', copies: 2, ...body });
const issue = (agent, student, bookId) => agent.post('/api/admin/library/issue', { student: { studentId: stu(student) }, bookId });

/* ---------------------------------------------------------------- library */

test('only the Administrator manages the library; the book catalogue rejects duplicate ISBNs', async () => {
  assert.equal((await t1.get('/api/admin/library/books')).status, 403);
  assert.equal((await clerk.get('/api/admin/library/books')).status, 403, 'only the Administrator runs the library desk');
  const hodUser = await makeStaff({ harness, hod, M, ctx, roleKey: 'hod', email: 'head@fac1.edu' });
  assert.equal((await hodUser.get('/api/admin/library/books')).status, 403, 'a HOD does not run the library desk');
  assert.equal((await addBook({ isbn: '12345' })).body.error.code, 'INVALID_ISBN');
  const book = await addBook({ isbn: '978-0-262-03384-8' });
  assert.equal(book.status, 201);
  assert.equal(book.body.data.copies.length, 2);
  assert.match(book.body.data.copies[0].accessionNo, /^LIB-\d{6}$/);
  const dup = await addBook({ isbn: '9780262033848' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'BOOK_EXISTS');
  const list = (await librarian.get('/api/admin/library/books?q=algo')).body.data;
  assert.equal(list[0].availableCopies, 2);
});

test('concurrent issues of the last copy: exactly one succeeds', async () => {
  const book = (await addBook({ title: 'Last Copy', copies: 1 })).body.data.book;
  const results = await Promise.all([0, 1, 2, 3].map(i => issue(librarian, i, id(book))));
  const ok = results.filter(r => r.status === 201);
  assert.equal(ok.length, 1);
  assert.ok(results.filter(r => r.status === 409).every(r => r.body.error.code === 'NO_COPY_AVAILABLE'));
  assert.equal(await M.LibraryIssue.countDocuments({ book: book._id, status: 'issued' }), 1);
  const copy = await M.BookCopy.findOne({ book: book._id });
  assert.equal(copy.status, 'issued');
  // return it so later tests start clean
  assert.equal((await librarian.post('/api/admin/library/return', { issueId: ok[0].body.data._id || ok[0].body.data.id })).status, 200);
  assert.equal((await M.BookCopy.findOne({ book: book._id })).status, 'available');
});

test('loan limits and overdue blocking are enforced', async () => {
  await M.LibraryIssue.deleteMany({}); await M.BookCopy.updateMany({}, { $set: { status: 'available' } });
  const book = (await addBook({ title: 'Many Copies', copies: 6 })).body.data.book;
  for (let i = 0; i < 3; i += 1) assert.equal((await issue(librarian, 0, id(book))).status, 201);
  const over = await issue(librarian, 0, id(book));
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'LOAN_LIMIT');

  // student 1 holds an overdue book -> blocked from borrowing again
  const first = await issue(librarian, 1, id(book));
  await M.LibraryIssue.updateOne({ _id: first.body.data._id }, { $set: { dueDate: addDays(today, -3) } });
  assert.equal((await issue(librarian, 1, id(book))).body.error.code, 'HAS_OVERDUE');
  assert.equal((await librarian.post('/api/admin/library/issue', { student: { rollNo: 'nope' }, bookId: id(book) })).body.error.code, 'STUDENT_NOT_FOUND');
});

test('a late return creates exactly one library-fine charge, capped, paid through the normal fee pipeline', async () => {
  const loan = await M.LibraryIssue.findOne({ student: stu(1), status: 'issued' });
  await M.LibraryIssue.updateOne({ _id: loan._id }, { $set: { dueDate: addDays(today, -5) } });
  const returns = await Promise.all([1, 2, 3].map(() => librarian.post('/api/admin/library/return', { issueId: id(loan) })));
  assert.deepEqual(returns.map(r => r.status).sort(), [200, 409, 409], 'a double submit returns the book once');
  const done = returns.find(r => r.status === 200).body.data;
  assert.equal(done.fine, 5 * 200, '5 days late at the default Rs 2/day');
  assert.equal(await M.FeeAssignment.countDocuments({ 'chargeRef.id': id(loan) }), 1, 'only one charge per loan');

  const sum = (await s2.get('/api/fees/summary')).body.data;
  const charge = sum.charges.find(c => c.category === 'library_fine');
  assert.ok(charge, 'the fine appears as a charge, not inside the semester fee');
  assert.equal(charge.outstandingPaise, 1000);
  assert.ok(!sum.semesters.some(s => s.category === 'library_fine'));

  const order = await s2.post('/api/fees/orders', { assignmentId: charge.id });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const orderId = order.body.data.checkout.orderId;
  const sim = (await s2.post(`/api/fees/orders/${orderId}/simulate`, { outcome: 'success' })).body.data;
  const verify = await s2.post(`/api/fees/orders/${orderId}/verify`, { paymentId: sim.paymentId, signature: sim.signature });
  assert.equal(verify.status, 200);
  const after = (await s2.get('/api/fees/summary')).body.data.charges.find(c => c.category === 'library_fine');
  assert.equal(after.outstandingPaise, 0);
  const receipt = await M.Receipt.findOne({ student: stu(1) });
  assert.equal(receipt.snapshot.category, 'library_fine');
  assert.match(receipt.snapshot.description, /Library fine/);
  const hist = (await s2.get('/api/fees/history')).body.data.transactions;
  assert.equal(hist[0].category, 'library_fine');
  const pdf = await s2.get(`/api/fees/receipts/${id(receipt)}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal((await s1.get(`/api/fees/receipts/${id(receipt)}/pdf`)).status, 404, 'another student cannot fetch the receipt');
});

test('the fine is capped at the college maximum and can be turned off', async () => {
  const lib = (await M.College.findById(ctx.college._id)).settings.library;
  assert.equal(libraryService.fineFor(addDays(today, -1000), today, lib), lib.maxFinePaise);
  assert.equal(libraryService.fineFor(today, today, lib), 0);
  assert.equal(libraryService.fineFor(addDays(today, 2), today, lib), 0, 'early returns have no fine');
});

test('lost books are recorded, the copy leaves circulation, and students see only their own loans', async () => {
  const book = (await addBook({ title: 'Lost One', copies: 1 })).body.data.book;
  const loan = (await issue(librarian, 3, id(book))).body.data;
  assert.equal((await librarian.post(`/api/admin/library/loans/${loan._id}/lost`, {})).status, 200);
  assert.equal((await M.BookCopy.findOne({ book: book._id })).status, 'lost');
  assert.equal((await issue(librarian, 2, id(book))).body.error.code, 'NO_COPY_AVAILABLE');
  const mine = (await s1.get('/api/student/library')).body.data;
  assert.ok(mine.length > 0 && mine.every(l => l.status));
  assert.ok(!JSON.stringify(mine).includes(ctx.students[1].profile.rollNo));
  assert.equal((await s1.get('/api/admin/library/loans')).status, 403);
});

test('due-date reminders are sent once per loan and kind', async () => {
  await M.LibraryIssue.deleteMany({}); await M.Notification.deleteMany({});
  const book = (await addBook({ title: 'Reminder Book', copies: 1 })).body.data.book;
  const loan = (await issue(librarian, 0, id(book))).body.data;
  await M.LibraryIssue.updateOne({ _id: loan._id }, { $set: { dueDate: addDays(today, 1) } });
  const college = await M.College.findById(ctx.college._id);
  assert.equal(await libraryService.remindDue(college, today), 1);
  assert.equal(await libraryService.remindDue(college, today), 0, 'a second run does not repeat the reminder');
  assert.equal(await M.Notification.countDocuments({ title: 'Book due tomorrow' }), 1);
});

/* ----------------------------------------------------------------- hostel removed */

test('the Hostel feature is gone: no routes, no student page, no permission', async () => {
  for (const url of ['/api/admin/hostel/hostels', '/api/admin/hostel/allocations', '/api/student/hostel']) {
    assert.ok([403, 404].includes((await hod.get(url)).status), url);
    assert.ok([403, 404].includes((await s1.get(url)).status), url);
  }
  assert.ok([403, 404].includes((await hod.post('/api/admin/hostel/hostels', { name: 'H', code: 'H1' })).status));
  const { PERMISSION_KEYS } = require('../../src/config/permissions');
  assert.ok(![...PERMISSION_KEYS].some(k => /hostel/i.test(k)));
  assert.ok(!require('../../src/models').Hostel, 'no Hostel model is registered');
  assert.equal(require('fs').existsSync(require('path').join(__dirname, '..', '..', 'src', 'services', 'hostelService.js')), false);
});
