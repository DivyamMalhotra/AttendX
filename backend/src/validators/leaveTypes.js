const { z, objectId, trimmed } = require('./common');

const body = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Use lowercase letters, digits and underscores'),
  name: trimmed(60), description: z.string().trim().max(200).optional(),
  exemptsAttendance: z.boolean().optional(), requiresDocument: z.boolean().optional(), sensitive: z.boolean().optional(),
  maxDaysPerRequest: z.number().int().min(1).max(31).optional(), active: z.boolean().optional()
});
const create = { body };
const update = { params: z.object({ id: objectId }), body: body.partial() };

module.exports = { create, update };
