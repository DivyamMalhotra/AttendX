const { Book, BookCopy, LibraryIssue } = require('../models/Facilities');
const { StudentProfile, Counter } = require('../models');
const { NOTIFICATION_TYPES } = require('../config/constants');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { todayISO, addDays, diffDays } = require('../utils/dates');
const { normalizeRollNo } = require('../utils/rollNumber');
const { escapeRegex } = require('../utils/pagination');
const charges = require('./chargeService');
const notifications = require('./notificationService');
const audit = require('./auditService');

const pad = (n, w = 6) => String(n).padStart(w, '0');
const cleanIsbn = v => String(v || '').replace(/[\s-]/g, '').toUpperCase();

/* ---------------------------------------------------------------- catalogue */

async function addCopies(collegeId, bookId, n) {
  const created = [];
  for (let i = 0; i < n; i += 1) {
    const seq = await Counter.next(`accession:${collegeId}`);
    created.push(await BookCopy.create({ college: collegeId, book: bookId, accessionNo: `LIB-${pad(seq)}` }));
  }
  return created;
}

async function addBook({ actor, college, input }) {
  const isbn = cleanIsbn(input.isbn);
  if (isbn && !/^(\d{9}[\dX]|\d{13})$/.test(isbn)) throw badRequest('ISBN must be 10 or 13 characters.', [{ field: 'isbn', message: 'Invalid ISBN.' }], 'INVALID_ISBN');
  let book;
  try {
    book = await Book.create({ college: college._id, title: input.title, author: input.author || '', category: input.category || 'General', publisher: input.publisher || '', ...(isbn ? { isbn } : {}) });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const existing = await Book.findOne({ college: college._id, isbn });
      throw conflict('BOOK_EXISTS', 'A book with that ISBN is already in the catalogue. Add copies to it instead.', { bookId: String(existing._id) });
    }
    throw err;
  }
  const copies = await addCopies(college._id, book._id, input.copies ?? 1);
  await audit.record({ actor, collegeId: college._id, action: 'library.book_added', entityType: 'Book', entityId: book._id, meta: { title: book.title, copies: copies.length } });
  return { book, copies };
}

async function addMoreCopies({ actor, college, bookId, count }) {
  const book = await Book.findOne({ _id: bookId, college: college._id });
  if (!book) throw notFound('Book not found.');
  const copies = await addCopies(college._id, book._id, count);
  await audit.record({ actor, collegeId: college._id, action: 'library.copies_added', entityType: 'Book', entityId: book._id, meta: { count } });
  return copies;
}

async function listBooks({ college, q, category, skip = 0, limit = 25 }) {
  const filter = { college: college._id };
  if (category) filter.category = category;
  if (q) { const rx = new RegExp(escapeRegex(q), 'i'); filter.$or = [{ title: rx }, { author: rx }, { isbn: new RegExp(escapeRegex(cleanIsbn(q))) }]; }
  const [total, books] = await Promise.all([Book.countDocuments(filter), Book.find(filter).sort({ title: 1 }).skip(skip).limit(limit).lean()]);
  const counts = await BookCopy.aggregate([
    { $match: { book: { $in: books.map(b => b._id) }, status: { $ne: 'retired' } } },
    { $group: { _id: '$book', total: { $sum: 1 }, available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } } } }
  ]);
  const by = new Map(counts.map(c => [String(c._id), c]));
  return { total, rows: books.map(b => ({ ...b, totalCopies: by.get(String(b._id))?.total || 0, availableCopies: by.get(String(b._id))?.available || 0 })) };
}

/* -------------------------------------------------------------------- loans */

async function resolveStudent(college, { studentId, rollNo }) {
  const profile = studentId
    ? await StudentProfile.findOne({ _id: studentId, college: college._id })
    : await StudentProfile.findOne({ college: college._id, rollNo: normalizeRollNo(rollNo) });
  if (!profile || !profile.active) throw badRequest('Student not found or not active.', undefined, 'STUDENT_NOT_FOUND');
  return profile;
}

/**
 * Lends one copy. The copy is claimed with an atomic available -> issued update (two simultaneous requests can
 * never get the same copy) and a unique index allows only one open loan per copy. Rules: a loan limit per student and no
 * new loans while the student holds an overdue book.
 */
async function issue({ actor, college, bookId, copyId, student }) {
  const profile = await resolveStudent(college, student);
  const lib = college.settings.library;
  const today = todayISO(college.settings.timezone);

  const open = await LibraryIssue.find({ student: profile._id, status: 'issued' }).select('dueDate').lean();
  if (open.length >= lib.maxActiveIssues) throw conflict('LOAN_LIMIT', `This student already has ${open.length} books out (limit ${lib.maxActiveIssues}).`);
  if (open.some(o => o.dueDate < today)) throw conflict('HAS_OVERDUE', 'This student has an overdue book. It must be returned before borrowing again.');

  const claim = copyId ? { _id: copyId, college: college._id } : { book: bookId, college: college._id };
  const copy = await BookCopy.findOneAndUpdate({ ...claim, status: 'available' }, { $set: { status: 'issued' } }, { returnDocument: 'after', sort: { accessionNo: 1 } });
  if (!copy) throw conflict('NO_COPY_AVAILABLE', 'No copy of that book is available right now.');

  try {
    const loan = await LibraryIssue.create({ college: college._id, copy: copy._id, book: copy.book, student: profile._id, issuedOn: today, dueDate: addDays(today, lib.loanDays), issuedBy: actor._id });
    await audit.record({ actor, collegeId: college._id, action: 'library.issued', entityType: 'LibraryIssue', entityId: loan._id, meta: { copy: copy.accessionNo, student: String(profile._id) } });
    return loan;
  } catch (err) {
    await BookCopy.updateOne({ _id: copy._id, status: 'issued' }, { $set: { status: 'available' } });   // give the copy back
    if (isDuplicateKey(err)) throw conflict('COPY_ALREADY_ISSUED', 'That copy is already on loan.');
    throw err;
  }
}

/** Late fine per configured rule: days late x daily rate, capped; 0 when on time. */
function fineFor(dueDate, onDate, lib) {
  const late = Math.max(0, diffDays(dueDate, onDate));
  return Math.min(late * lib.finePerDayPaise, lib.maxFinePaise);
}

/**
 * Takes a book back. The loan moves issued -> returned in one atomic step, so a double submit cannot return it
 * twice or assess the fine twice; the fine becomes a separate "library fine" charge tied to this loan (one per loan).
 */
async function returnBook({ actor, college, issueId, accessionNo }) {
  let id = issueId;
  if (!id && accessionNo) {
    const copy = await BookCopy.findOne({ college: college._id, accessionNo: String(accessionNo).toUpperCase() }).select('_id').lean();
    const loan = copy && await LibraryIssue.findOne({ copy: copy._id, status: 'issued' }).select('_id').lean();
    id = loan && loan._id;
  }
  if (!id) throw notFound('No open loan found for that copy.');
  const today = todayISO(college.settings.timezone);
  const loan = await LibraryIssue.findOneAndUpdate({ _id: id, college: college._id, status: 'issued' }, { $set: { status: 'returned', returnedOn: today, returnedBy: actor._id } }, { returnDocument: 'after' });
  if (!loan) throw conflict('NOT_ON_LOAN', 'That book is not currently on loan.');
  await BookCopy.updateOne({ _id: loan.copy, status: 'issued' }, { $set: { status: 'available' } });

  const lib = college.settings.library;
  const fine = fineFor(loan.dueDate, today, lib);
  let chargeDoc = null;
  if (fine > 0) {
    await LibraryIssue.updateOne({ _id: loan._id }, { $set: { fineAssessedPaise: fine } });
    if (lib.chargeFinesToFees) {
      const book = await Book.findById(loan.book).select('title').lean();
      chargeDoc = (await charges.createCharge({
        actor, college, studentId: loan.student, category: 'library_fine', description: `Library fine: ${book ? book.title : 'book'}`,
        amountPaise: fine, source: { kind: 'library_issue', id: loan._id }
      })).charge;
      await LibraryIssue.updateOne({ _id: loan._id }, { $set: { fineCharge: chargeDoc._id } });
      const profile = await StudentProfile.findById(loan.student).select('user').lean();
      await notifications.notify({
        collegeId: college._id, userId: profile.user, type: NOTIFICATION_TYPES.LIBRARY, title: 'Library fine',
        message: `A fine was added to your fees for returning "${book ? book.title : 'a book'}" late.`, data: { issueId: String(loan._id) },
        dedupeKey: `libfine:${loan._id}`, link: 'student.html#fees'
      });
    }
  }
  await audit.record({ actor, collegeId: college._id, action: 'library.returned', entityType: 'LibraryIssue', entityId: loan._id, meta: { fine } });
  return { loan: await LibraryIssue.findById(loan._id), fine, charge: chargeDoc };
}

async function markLost({ actor, college, issueId }) {
  const loan = await LibraryIssue.findOneAndUpdate({ _id: issueId, college: college._id, status: 'issued' }, { $set: { status: 'lost', returnedOn: todayISO(college.settings.timezone), returnedBy: actor._id } }, { returnDocument: 'after' });
  if (!loan) throw conflict('NOT_ON_LOAN', 'That book is not currently on loan.');
  await BookCopy.updateOne({ _id: loan.copy }, { $set: { status: 'lost' } });
  await audit.record({ actor, collegeId: college._id, action: 'library.lost', entityType: 'LibraryIssue', entityId: loan._id });
  return loan;
}

const decorate = (rows, lib, today) => rows.map(r => ({
  id: String(r._id), book: r.book, copy: r.copy, student: r.student, issuedOn: r.issuedOn, dueDate: r.dueDate, returnedOn: r.returnedOn, status: r.status,
  overdue: r.status === 'issued' && r.dueDate < today, daysOverdue: r.status === 'issued' ? Math.max(0, diffDays(r.dueDate, today)) : 0,
  fineNowPaise: r.status === 'issued' ? fineFor(r.dueDate, today, lib) : r.fineAssessedPaise
}));

async function loans({ college, status, overdueOnly, skip = 0, limit = 50 }) {
  const today = todayISO(college.settings.timezone);
  const filter = { college: college._id, ...(status ? { status } : {}), ...(overdueOnly ? { status: 'issued', dueDate: { $lt: today } } : {}) };
  const [total, rows] = await Promise.all([
    LibraryIssue.countDocuments(filter),
    LibraryIssue.find(filter).sort({ dueDate: 1 }).skip(skip).limit(limit).populate('book', 'title author').populate('copy', 'accessionNo')
      .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).lean()
  ]);
  return { total, rows: decorate(rows, college.settings.library, today) };
}

async function studentLoans({ college, profile }) {
  const today = todayISO(college.settings.timezone);
  const rows = await LibraryIssue.find({ student: profile._id }).sort({ createdAt: -1 }).limit(100).populate('book', 'title author').populate('copy', 'accessionNo').lean();
  return decorate(rows, college.settings.library, today);
}

/** Reminders: the day before the due date and once it is overdue. Idempotent per loan and kind. */
async function remindDue(college, today = todayISO(college.settings.timezone)) {
  const rows = await LibraryIssue.find({ college: college._id, status: 'issued', dueDate: { $in: [addDays(today, 1), today] }, }).populate('book', 'title').lean();
  const overdue = await LibraryIssue.find({ college: college._id, status: 'issued', dueDate: { $lt: today } }).populate('book', 'title').lean();
  let sent = 0;
  for (const r of [...rows, ...overdue]) {
    const kind = r.dueDate < today ? `overdue:${Math.floor(diffDays(r.dueDate, today) / 7)}` : r.dueDate === today ? 'due' : 'soon';
    const profile = await StudentProfile.findById(r.student).select('user').lean();
    const n = await notifications.notify({
      collegeId: college._id, userId: profile.user, type: NOTIFICATION_TYPES.LIBRARY,
      title: kind === 'soon' ? 'Book due tomorrow' : kind === 'due' ? 'Book due today' : 'Book overdue',
      message: `"${r.book ? r.book.title : 'A book'}" ${kind.startsWith('overdue') ? 'was due on' : 'is due on'} ${r.dueDate}.${kind.startsWith('overdue') ? ' A daily fine applies.' : ''}`,
      data: { issueId: String(r._id) }, dedupeKey: `libdue:${r._id}:${kind}`, link: 'student.html#library'
    });
    if (n) sent += 1;
  }
  return sent;
}

module.exports = { addBook, addMoreCopies, listBooks, issue, returnBook, markLost, loans, studentLoans, remindDue, fineFor };
