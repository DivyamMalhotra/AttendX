const { z, objectId, trimmed, paise, pagination } = require('./common');
const { REFUND_STATUS } = require('../config/constants');

const id = { params: z.object({ id: objectId }) };

const refundRequest = {
  body: z.object({
    paymentId: objectId, amountPaise: paise.refine(n => n >= 100, 'The smallest refund is 1 rupee'),
    reason: trimmed(300), reduceFee: z.boolean().optional()
  })
};
const refundDecision = { ...id, body: z.object({ note: z.string().trim().max(300).optional() }) };
const refundList = { query: z.object({ status: z.enum(Object.values(REFUND_STATUS)).optional(), studentId: objectId.optional(), ...pagination }) };

const policy = {
  body: z.object({
    active: z.boolean().optional(),
    categories: z.array(z.enum(['semester', 'library_fine', 'hostel', 'other'])).min(1).optional(),
    graceDays: z.number().int().min(0).max(365).optional(),
    mode: z.enum(['flat', 'percent']).optional(),
    flatPaise: paise.optional(),
    percentBp: z.number().int().min(0).max(10000).optional(),
    period: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    capPaise: paise.optional()
  }).strict().refine(p => Object.keys(p).length > 0, 'No changes supplied')
    .refine(p => p.mode !== 'flat' || p.flatPaise === undefined || p.flatPaise >= 0, 'Invalid amount')
};
const lateFeeList = { query: z.object({ status: z.enum(['assessed', 'waived', 'void']).optional(), studentId: objectId.optional(), ...pagination }) };
const waive = { ...id, body: z.object({ reason: z.string().trim().max(300).optional() }) };

module.exports = { refundRequest, refundDecision, refundList, policy, lateFeeList, waive, id };
