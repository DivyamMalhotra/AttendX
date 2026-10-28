const { STAFF_ROLE_KEYS } = require('../config/constants');
const { z, objectId, trimmed, email, password } = require('./common');

const id = { params: z.object({ id: objectId }) };
const permissions = z.array(z.string().max(60)).max(100);

const roleCreate = {
  body: z.object({
    key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Use lowercase letters, digits and underscores'),
    name: trimmed(60), description: z.string().trim().max(200).optional(),
    permissions, scope: z.enum(['college', 'department']).optional()
  })
};
const roleUpdate = {
  ...id,
  body: z.object({
    name: trimmed(60).optional(), description: z.string().trim().max(200).optional(),
    permissions: permissions.optional(), scope: z.enum(['college', 'department']).optional(), active: z.boolean().optional()
  })
};

const staffCreate = {
  body: z.object({
    name: trimmed(120), email, password, phone: z.string().trim().max(20).optional(),
    role: z.enum(STAFF_ROLE_KEYS), departmentIds: z.array(objectId).max(20).optional()
  })
};
const staffUpdate = {
  ...id,
  body: z.object({
    departmentIds: z.array(objectId).max(20).optional(),
    active: z.boolean().optional(), phone: z.string().trim().max(20).optional(), password: password.optional()
  })
};

const departmentSave = {
  body: z.object({
    name: trimmed(80), code: z.string().trim().min(2).max(12), campus: z.string().trim().max(80).optional(),
    head: objectId.nullable().optional(), active: z.boolean().optional()
  })
};
const departmentUpdate = { ...id, body: departmentSave.body.partial() };
const sectionDepartment = { ...id, body: z.object({ departmentId: objectId.nullable() }) };

module.exports = { roleCreate, roleUpdate, staffCreate, staffUpdate, departmentSave, departmentUpdate, sectionDepartment, id };
