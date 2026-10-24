const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('../helpers/testApp');
const { seedCollege, creds, makeStaff } = require('../helpers/fixtures');
const { todayISO, addDays } = require('../../src/utils/dates');
const { installFakeProviders, removeFakeProviders } = require('../helpers/fakes');
const libraryService = require('../../src/services/libraryService');

let ctx; let M; let hod; let t1; let s1; let s2; let librarian; let warden;
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
  librarian = await makeStaff({ harness, hod, M, ctx, roleKey: 'librarian', email: 'lib@fac1.edu' });
  warden = await makeStaff({ harness, hod, M, ctx, roleKey: 'hostel_warden', email: 'warden@fac1.edu' });
});
after(async () => { removeFakeProviders(); await harness.stop(); });

const addBook = (body = {}) => librarian.post('/api/admin/library/books', { title: 'Algorithms', author: 'CLRS', copies: 2, ...body });
const issue = (agent, student, bookId) => agent.post('/api/admin/library/issue', { student: { studentId: stu(student) }, bookId });

/* ---------------------------------------------------------------- library */

test('only library staff manage the library; the book catalogue rejects duplicate ISBNs', async () => {
  assert.equal((await t1.get('/api/admin/library/books')).status, 403);
  assert.equal((await warden.get('/api/admin/library/books')).status, 403, 'hostel staff cannot use the library desk');
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

/* ----------------------------------------------------------------- hostel */

async function setupHostel(code = 'H1', capacity = 2, fee = 500000) {
  const h = (await warden.post('/api/admin/hostel/hostels', { name: `Hostel ${code}`, code, type: 'mixed', feePerTermPaise: fee })).body.data;
  await warden.post(`/api/admin/hostel/hostels/${h._id}/rooms`, { groups: [{ floor: 1, capacity, numbers: ['101', '102'] }] });
  const rooms = (await warden.get(`/api/admin/hostel/hostels/${h._id}/rooms`)).body.data;
  return { hostel: h, rooms };
}
const allocate = (agent, student, roomId, extra = {}) => agent.post('/api/admin/hostel/allocations', { student: { studentId: stu(student) }, roomId: id(roomId), ...extra });

test('hostel set-up needs hostel.manage and room creation is idempotent', async () => {
  assert.equal((await librarian.get('/api/admin/hostel/hostels')).status, 403);
  assert.equal((await t1.post('/api/admin/hostel/hostels', { name: 'X', code: 'XX' })).status, 403);
  const { hostel } = await setupHostel('H1');
  assert.equal((await warden.post('/api/admin/hostel/hostels', { name: 'Again', code: 'H1' })).status, 409);
  const again = await warden.post(`/api/admin/hostel/hostels/${hostel._id}/rooms`, { groups: [{ floor: 1, capacity: 2, numbers: ['101', '102', '103'] }] });
  assert.deepEqual([again.body.data.created, again.body.data.existing], [1, 2]);
});

test('capacity can never be exceeded, even under concurrent allocation', async () => {
  const { rooms } = await setupHostel('H2', 2);
  const room = rooms[0];
  const results = await Promise.all([0, 1, 2, 3].map(i => allocate(warden, i, room._id)));
  assert.equal(results.filter(r => r.status === 201).length, 2);
  assert.ok(results.filter(r => r.status !== 201).every(r => r.status === 409 && r.body.error.code === 'ROOM_FULL'));
  const fresh = await M.HostelRoom.findById(room._id);
  assert.equal(fresh.occupied, 2);
  assert.equal(await M.HostelAllocation.countDocuments({ room: room._id, status: { $in: ['allocated', 'checked_in'] } }), 2);
  await M.HostelAllocation.deleteMany({}); await M.HostelRoom.updateMany({}, { $set: { occupied: 0 } });
});

test('a student holds one bed; transfers keep history and counts; check-out frees the bed once', async () => {
  const { hostel, rooms } = await setupHostel('H3', 1, 0);
  const [a, b] = rooms;
  const alloc = (await allocate(warden, 0, a._id)).body.data;
  assert.equal((await allocate(warden, 0, b._id)).body.error.code, 'ALREADY_ALLOCATED');
  assert.equal((await M.HostelRoom.findById(b._id)).occupied, 0, 'a refused allocation does not leave a bed claimed');
  assert.equal((await warden.post(`/api/admin/hostel/allocations/${alloc._id}/check-in`)).status, 200);
  assert.equal((await warden.post(`/api/admin/hostel/allocations/${alloc._id}/check-in`)).status, 409);

  const moved = await warden.post(`/api/admin/hostel/allocations/${alloc._id}/transfer`, { toRoomId: id(b), reason: 'Room repair' });
  assert.equal(moved.status, 200);
  assert.deepEqual([(await M.HostelRoom.findById(a._id)).occupied, (await M.HostelRoom.findById(b._id)).occupied], [0, 1]);
  assert.equal(await M.HostelAllocation.countDocuments({ student: stu(0) }), 2, 'history is kept');
  assert.equal((await warden.post(`/api/admin/hostel/allocations/${alloc._id}/transfer`, { toRoomId: id(a) })).status, 409, 'the old allocation is already ended');
  assert.equal((await allocate(warden, 1, b._id)).body.error.code, 'ROOM_FULL');
  assert.equal((await warden.patch(`/api/admin/hostel/rooms/${b._id}`, { active: false })).body.error.code, 'ROOM_OCCUPIED');

  const current = moved.body.data;
  const ends = await Promise.all([1, 2].map(() => warden.post(`/api/admin/hostel/allocations/${current._id}/end`, { reason: 'Left' })));
  assert.deepEqual(ends.map(r => r.status).sort(), [200, 409]);
  assert.equal((await M.HostelRoom.findById(b._id)).occupied, 0, 'released exactly once');
  assert.ok(hostel);
});

test('a hostel allocation can create one hostel charge that students pay like any other fee', async () => {
  const { rooms } = await setupHostel('H4', 2, 750000);
  const alloc = (await allocate(warden, 2, rooms[0]._id, { charge: true })).body.data;
  assert.ok(alloc.charge);
  assert.equal(await M.FeeAssignment.countDocuments({ 'chargeRef.id': id(alloc) }), 1);
  const s3 = await harness.login(creds(ctx.college, ctx.students[2].user));
  const charge = (await s3.get('/api/fees/summary')).body.data.charges.find(c => c.category === 'hostel');
  assert.equal(charge.totalPayablePaise, 750000);
  const stay = (await s3.get('/api/student/hostel')).body.data;
  assert.ok(stay.length >= 1);
  assert.equal((await s1.get('/api/admin/hostel/allocations')).status, 403);
  // students not allocated see no one else's room
  assert.deepEqual((await s2.get('/api/student/hostel')).body.data, []);
});
