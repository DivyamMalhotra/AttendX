const { z, objectId } = require('./common');

const kind = z.enum(['students', 'books', 'marks']);
const preview = {
  params: z.object({ kind }),
  // multipart text fields: examId/reason are only used by the "marks" import
  body: z.object({ examId: objectId.optional(), reason: z.string().trim().max(200).optional() })
};
const confirm = { params: z.object({ id: objectId }), body: z.object({ skipInvalid: z.boolean().optional() }) };
const idParam = { params: z.object({ id: objectId }) };
const template = { params: z.object({ kind }) };
const exportKind = { params: z.object({ kind: z.enum(['students', 'fees', 'payments', 'loans']) }) };

module.exports = { preview, confirm, idParam, template, exportKind };
