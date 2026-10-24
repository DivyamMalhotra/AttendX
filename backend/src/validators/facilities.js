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

/* ---- hostel ---- */
const hostelSave = {
  body: z.object({
    name: trimmed(80), code: z.string().trim().min(2).max(12), type: z.enum(['boys', 'girls', 'mixed']).optional(),
    warden: objectId.nullable().optional(), feePerTermPaise: z.number().int().min(0).max(100_000_000).optional(), active: z.boolean().optional()
  })
};
const hostelUpdate = { ...id, body: hostelSave.body.partial() };
const rooms = {
  ...id,
  body: z.object({ groups: z.array(z.object({ floor: z.number().int().min(0).max(50), capacity: z.number().int().min(1).max(20), numbers: z.array(z.string().trim().min(1).max(12)).min(1).max(200) })).min(1).max(30) })
};
const roomUpdate = { ...id, body: z.object({ capacity: z.number().int().min(1).max(20).optional(), active: z.boolean().optional(), floor: z.number().int().min(0).max(50).optional() }) };
const allocate = { body: z.object({ student: who, roomId: objectId, from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), charge: z.boolean().optional() }) };
const endAlloc = { ...id, body: z.object({ reason: z.string().trim().max(200).optional() }) };
const transfer = { ...id, body: z.object({ toRoomId: objectId, reason: z.string().trim().max(200).optional() }) };
const allocList = { query: z.object({ status: z.enum(['active', 'allocated', 'checked_in', 'ended']).optional(), hostelId: objectId.optional(), ...pagination }) };

module.exports = { id, bookAdd, copiesAdd, bookList, issue, returnBook, loanList, hostelSave, hostelUpdate, rooms, roomUpdate, allocate, endAlloc, transfer, allocList };
