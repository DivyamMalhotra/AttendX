const { z, objectId, trimmed, pagination } = require('./common');

const id = { params: z.object({ id: objectId }) };
const who = z.object({ studentId: objectId.optional(), rollNo: z.string().trim().min(1).max(40).optional() }).refine(v => v.studentId || v.rollNo, 'Give a student id or roll number');

/* ---- library ---- */
const bookAdd = {
  body: z.object({
    title: trimmed(200), author: z.string().trim().max(120).optional(), isbn: z.string().trim().max(24).optional(),
    category: z.string().trim().max(60).optional(), publisher: z.string().trim().max(100).optional(), copies: z.number().int().min(0).max(200).optional()
  })
};
const copiesAdd = { ...id, body: z.object({ count: z.number().int().min(1).max(200) }) };
const bookList = { query: z.object({ q: z.string().trim().max(80).optional(), category: z.string().trim().max(60).optional(), ...pagination }) };
const issue = { body: z.object({ student: who, bookId: objectId.optional(), copyId: objectId.optional() }).refine(b => b.bookId || b.copyId, 'Choose a book or a copy') };
const returnBook = { body: z.object({ issueId: objectId.optional(), accessionNo: z.string().trim().max(30).optional() }).refine(b => b.issueId || b.accessionNo, 'Give the loan or the copy number') };
const loanList = { query: z.object({ status: z.enum(['issued', 'returned', 'lost']).optional(), overdue: z.enum(['true', 'false']).optional(), ...pagination }) };


module.exports = { id, bookAdd, copiesAdd, bookList, issue, returnBook, loanList };
