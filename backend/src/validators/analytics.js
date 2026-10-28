const { z, objectId } = require('./common');

const overview = { query: z.object({ sectionId: objectId.optional(), sessionId: objectId.optional() }) };
const atRisk = { query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), format: z.enum(['json', 'csv']).optional() }) };

module.exports = { overview, atRisk };
