const { z, objectId, isoDate, trimmed, email, password } = require('./common');

const studentParam = { params: z.object({ studentId: objectId }) };
const idParam = { params: z.object({ id: objectId }) };

const assign = {
  body: z.object({ studentIds: z.array(objectId).min(1).max(300), mentorId: objectId, sessionId: objectId.optional(), reason: z.string().trim().max(200).optional() })
};

const category = z.enum(['academic', 'attendance', 'personal', 'career', 'financial', 'other']);
const noteCreate = {
  params: z.object({ studentId: objectId }),
  body: z.object({
    content: z.string().trim().min(3).max(5000), category: category.optional(), noteDate: isoDate.optional(), context: z.string().trim().max(200).optional(),
    followUpAction: z.string().trim().max(300).optional(), followUpDate: isoDate.nullable().optional()
  })
};
const noteUpdate = {
  params: z.object({ id: objectId }),
  body: z.object({
    content: z.string().trim().min(3).max(5000).optional(), category: category.optional(),
    followUpAction: z.string().trim().max(300).optional(), followUpDate: isoDate.nullable().optional(), followUpDone: z.boolean().optional()
  })
};

const relationship = z.enum(['mother', 'father', 'guardian', 'other']);
const parentCreate = {
  body: z.object({
    name: trimmed(120), email, password, phone: z.string().trim().max(20).optional(), studentId: objectId,
    relationship: relationship.optional(), verificationNote: z.string().trim().min(5, 'Say how the person was verified').max(300)
  })
};
const linkCreate = {
  body: z.object({ parentId: objectId, studentId: objectId, relationship: relationship.optional(), verificationNote: z.string().trim().min(5).max(300) })
};
const revoke = { params: z.object({ id: objectId }), body: z.object({ reason: z.string().trim().max(200).optional() }) };
const linkList = { query: z.object({ studentId: objectId.optional() }) };
const childParam = { params: z.object({ studentId: objectId, area: z.enum(['summary', 'attendance', 'leave', 'results', 'fees', 'payments']) }) };

const timelineQuery = {
  query: z.object({
    from: isoDate.optional(), to: isoDate.optional(), sessionId: objectId.optional(), semester: z.coerce.number().int().min(1).max(12).optional(),
    categories: z.string().max(200).optional().transform(v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined)),
    before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).optional()
  })
};
const timelineStudent = { params: z.object({ studentId: objectId }), query: timelineQuery.query };

module.exports = { timelineQuery, timelineStudent, studentParam, idParam, assign, noteCreate, noteUpdate, parentCreate, linkCreate, revoke, linkList, childParam };
