const { z, objectId, isoDate } = require('./common');
const { TIME_SLOTS } = require('../config/constants');

const slot = z.enum(TIME_SLOTS);
const records = z.array(z.object({ studentId: objectId, status: z.enum(['P', 'A']) })).min(1).max(500);

const submit = {
  body: z.object({ subjectId: objectId, date: isoDate, slot, records, expectNew: z.boolean().optional() })
};

const update = {
  params: z.object({ sessionId: objectId }),
  body: z.object({ date: isoDate, slot, records })
};

const lookup = {
  query: z.object({ subjectId: objectId, date: isoDate, slot })
};

const sessionParam = { params: z.object({ sessionId: objectId }) };
const subjectParam = { params: z.object({ subjectId: objectId }) };

module.exports = { submit, update, lookup, sessionParam, subjectParam };
