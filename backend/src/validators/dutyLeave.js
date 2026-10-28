const { z, objectId, isoDate, pagination } = require('./common');

const create = {
  body: z.object({
    leaveTypeId: objectId.optional(),
    fromDate: isoDate,
    toDate: isoDate,
    reason: z.string().trim().min(3, 'Please give a reason').max(500)
  })
};

const review = {
  params: z.object({ requestId: objectId }),
  body: z.object({
    decision: z.enum(['approved', 'rejected']),
    remark: z.string().trim().max(500).optional()
  })
};

const idParam = { params: z.object({ requestId: objectId }) };

const list = {
  query: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
    ...pagination
  })
};

module.exports = { create, review, idParam, list };
