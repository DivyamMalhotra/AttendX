const { z, objectId } = require('./common');

const classParam = { params: z.object({ id: objectId }) };
const start = { params: z.object({ id: objectId }), body: z.object({ minutes: z.number().int().min(1).max(180).optional() }) };
const scan = {
  body: z.object({
    sessionId: objectId, code: z.string().trim().regex(/^\d{4,6}$/, 'The code is 6 digits'),
    lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).max(100000).optional()
  })
};

module.exports = { classParam, start, scan };
