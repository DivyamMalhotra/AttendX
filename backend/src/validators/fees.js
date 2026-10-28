const { z, objectId, isoDate, trimmed, paise, pagination } = require('./common');
const { FEE_COMPONENT_KINDS } = require('../config/constants');

const component = z.object({
  name: trimmed(80),
  kind: z.enum(FEE_COMPONENT_KINDS).optional(),
  amountPaise: paise.refine(n => n > 0, 'Amount must be greater than zero')
});

const structureCreate = {
  body: z.object({
    course: trimmed(80), specialization: z.string().trim().max(80).optional(),
    academicSessionId: objectId, semesterNumber: z.number().int().min(1).max(12),
    components: z.array(component).min(1).max(20), dueDate: isoDate.nullable().optional()
  })
};
const structureUpdate = {
  params: z.object({ id: objectId }),
  body: z.object({ components: z.array(component).min(1).max(20).optional(), dueDate: isoDate.nullable().optional() })
};
const idParam = { params: z.object({ id: objectId }) };

const assign = {
  body: z.object({
    structureId: objectId,
    sectionId: objectId.optional(),
    studentIds: z.array(objectId).min(1).max(500).optional()
  }).refine(b => b.sectionId || b.studentIds, 'Choose a section or students')
};
const adjust = {
  params: z.object({ id: objectId }),
  body: z.object({
    kind: z.enum(['concession', 'charge']), label: trimmed(120),
    amountPaise: paise.refine(n => n > 0, 'Amount must be greater than zero')
  })
};

const assignmentList = {
  query: z.object({
    sectionId: objectId.optional(), sessionId: objectId.optional(), semesterNumber: z.coerce.number().int().min(1).max(12).optional(),
    status: z.enum(['paid', 'partial', 'unpaid']).optional(), q: z.string().trim().max(40).optional(), ...pagination
  })
};
const transactionList = {
  query: z.object({
    status: z.enum(['created', 'pending', 'success', 'failed', 'cancelled']).optional(),
    from: isoDate.optional(), to: isoDate.optional(), q: z.string().trim().max(60).optional(),
    needsReview: z.enum(['true', 'false']).optional(), format: z.enum(['json', 'csv']).optional(), ...pagination
  })
};
const outstandingQuery = {
  query: z.object({
    sessionId: objectId.optional(), sectionId: objectId.optional(),
    semesterNumber: z.coerce.number().int().min(1).max(12).optional(), format: z.enum(['json', 'csv']).optional()
  })
};

/* ----- student payment flow ----- */
const createOrder = {
  body: z.object({ assignmentId: objectId, amountPaise: z.number().int().min(100).max(100_000_000_00).optional() })
};
const orderParam = { params: z.object({ orderId: z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9_]+$/) }) };
const verify = {
  ...orderParam,
  body: z.object({ paymentId: z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9_]+$/), signature: z.string().trim().min(10).max(200) })
};
const simulatorPay = {
  ...orderParam,
  body: z.object({ outcome: z.enum(['success', 'failure', 'authorized']) })
};
const receiptParam = { params: z.object({ receiptId: objectId }) };

module.exports = {
  structureCreate, structureUpdate, idParam, assign, adjust, assignmentList, transactionList, outstandingQuery,
  createOrder, orderParam, verify, simulatorPay, receiptParam
};
