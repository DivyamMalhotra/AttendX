const { z, objectId, isoDate } = require('./common');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 hour)');
const id = { params: z.object({ id: objectId }) };

const create = {
  body: z.object({
    sectionId: objectId, academicSessionId: objectId, effectiveFrom: isoDate, effectiveTo: isoDate.nullable().optional(),
    copyFromLatest: z.boolean().optional()
  })
};

const entry = {
  params: z.object({ id: objectId }),
  body: z.object({
    subjectId: objectId, teacherId: objectId.optional(), dayOfWeek: z.number().int().min(1).max(7),
    startTime: hhmm, endTime: hhmm, room: z.string().trim().max(40).optional(),
    overrideReason: z.string().trim().min(5).max(200).optional()
  })
};
const entryParam = { params: z.object({ id: objectId, entryId: objectId }) };

const list = { query: z.object({ sectionId: objectId.optional() }) };
const generate = { body: z.object({ from: isoDate, to: isoDate }) };

const sessionAction = { params: z.object({ id: objectId }) };
const cancelSession = { params: z.object({ id: objectId }), body: z.object({ reason: z.string().trim().min(3).max(200) }) };
const resolveSession = {
  params: z.object({ id: objectId }),
  body: z.object({ action: z.enum(['explained', 'cancelled', 'completed_without_attendance']), reason: z.string().trim().min(3).max(300) })
};
const today = { query: z.object({ date: isoDate.optional(), teacherId: objectId.optional() }) };

module.exports = { id, create, entry, entryParam, list, generate, sessionAction, cancelSession, resolveSession, today };
