const { z, objectId } = require('./common');

const json = schema => z.string().transform((v, ctx) => { try { return JSON.parse(v); } catch (e) { ctx.addIssue({ code: 'custom', message: 'Invalid JSON' }); return z.NEVER; } }).pipe(schema);
const bool = z.enum(['true', 'false']).transform(v => v === 'true');
const when = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Use a valid date and time').transform(v => new Date(v));

const audience = z.object({
  all: z.boolean().optional(),
  roles: z.array(z.enum(['student', 'teacher', 'hod', 'accounts_clerk', 'exam_cell', 'parent', 'admin'])).max(7).optional(),
  departments: z.array(objectId).max(50).optional(),
  courses: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  semesters: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  sections: z.array(objectId).max(200).optional()
});

// Created through multipart (attachments), so scalar fields are strings.
const create = {
  body: z.object({
    title: z.string().trim().min(2).max(160), body: z.string().trim().min(2).max(10000),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), audience: json(audience),
    publishAt: when.optional(), expiresAt: when.optional(), notifyEmail: bool.optional(), notifySms: bool.optional(), publishNow: bool.optional()
  })
};
const update = {
  params: z.object({ id: objectId }),
  body: z.object({
    title: z.string().trim().min(2).max(160).optional(), body: z.string().trim().min(2).max(10000).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), audience: audience.optional(),
    publishAt: z.string().datetime().transform(v => new Date(v)).nullable().optional(), expiresAt: z.string().datetime().transform(v => new Date(v)).nullable().optional()
  })
};
const id = { params: z.object({ id: objectId }) };
const feed = { query: z.object({ unread: z.enum(['true', 'false']).optional() }) };

module.exports = { create, update, id, feed };
