const { z, objectId } = require('./common');

// Multipart bodies arrive as strings, so booleans/numbers/dates are parsed explicitly.
const bool = z.enum(['true', 'false']).transform(v => v === 'true');
const when = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Use a valid date and time').transform(v => new Date(v));

const create = {
  body: z.object({
    subjectId: objectId, title: z.string().trim().min(2).max(140), instructions: z.string().trim().max(5000).optional(),
    publishAt: when.optional(), deadline: when, maxMarks: z.coerce.number().min(0).max(1000).optional(),
    allowLate: bool.optional(), allowResubmit: bool.optional()
  })
};
const update = {
  params: z.object({ id: objectId }),
  body: z.object({
    title: z.string().trim().min(2).max(140).optional(), instructions: z.string().trim().max(5000).optional(),
    publishAt: z.string().datetime().transform(v => new Date(v)).nullable().optional(),
    deadline: z.string().datetime().transform(v => new Date(v)).optional(), maxMarks: z.number().min(0).max(1000).optional(),
    allowLate: z.boolean().optional(), allowResubmit: z.boolean().optional()
  })
};
const id = { params: z.object({ id: objectId }) };
const grade = {
  params: z.object({ id: objectId, studentId: objectId }),
  body: z.object({ action: z.enum(['grade', 'return']).default('grade'), marks: z.number().min(0).nullable().optional(), feedback: z.string().trim().max(2000).optional() })
};
const submit = { params: z.object({ id: objectId }), body: z.object({ note: z.string().trim().max(1000).optional() }) };
const material = {
  body: z.object({
    subjectId: objectId, title: z.string().trim().min(2).max(140), topic: z.string().trim().max(100).optional(),
    resourceType: z.enum(['lecture_notes', 'slides', 'reference', 'question_paper', 'other']).optional()
  })
};
const materialList = { query: z.object({ subjectId: objectId.optional() }) };
const file = { params: z.object({ kind: z.enum(['assignment', 'submission', 'material', 'announcement']), id: objectId, index: z.coerce.number().int().min(0).max(10).default(0) }) };
const fileNoIndex = { params: z.object({ kind: z.enum(['assignment', 'submission', 'material', 'announcement']), id: objectId }) };

module.exports = { create, update, id, grade, submit, material, materialList, file, fileNoIndex };
