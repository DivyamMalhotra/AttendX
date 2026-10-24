const { LeaveType } = require('../models');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const audit = require('./auditService');

/** Types every college starts with; administrators can edit them or add their own. */
const DEFAULTS = [
  { key: 'duty', name: 'Duty leave', description: 'Representing the college (sports, competitions, events).', exemptsAttendance: true, requiresDocument: false, sensitive: false },
  { key: 'medical', name: 'Medical leave', description: 'Illness or medical treatment. Documents are visible to medical reviewers only.', exemptsAttendance: false, requiresDocument: true, sensitive: true },
  { key: 'personal', name: 'Personal leave', description: 'Personal or family reasons.', exemptsAttendance: false, requiresDocument: false, sensitive: false }
];

/** Idempotent: creates the default types if missing, never overwrites an edited one. */
async function ensureDefaults(collegeId) {
  await Promise.all(DEFAULTS.map(d => LeaveType.updateOne({ college: collegeId, key: d.key }, { $setOnInsert: { ...d, builtIn: true } }, { upsert: true })));
}

async function list(collegeId, { activeOnly = false } = {}) {
  await ensureDefaults(collegeId);
  return LeaveType.find({ college: collegeId, ...(activeOnly ? { active: true } : {}) }).sort({ builtIn: -1, name: 1 }).lean();
}

/** The type used for requests created before leave types existed (and when none is chosen). */
async function dutyType(collegeId) {
  await ensureDefaults(collegeId);
  return LeaveType.findOne({ college: collegeId, key: 'duty' });
}

async function getActive(collegeId, id) {
  const type = id ? await LeaveType.findOne({ _id: id, college: collegeId }) : await dutyType(collegeId);
  if (!type || !type.active) throw badRequest('Choose a valid leave type.', undefined, 'LEAVE_TYPE_NOT_FOUND');
  return type;
}

async function save(actor, collegeId, id, input) {
  try {
    let type;
    if (id) {
      type = await LeaveType.findOne({ _id: id, college: collegeId });
      if (!type) throw notFound('Leave type not found.');
      const { key, ...rest } = input;   // the key never changes after creation
      Object.assign(type, rest);
      await type.save();
    } else {
      type = await LeaveType.create({ college: collegeId, ...input });
    }
    await audit.record({ actor, collegeId, action: id ? 'leave_type.updated' : 'leave_type.created', entityType: 'LeaveType', entityId: type._id, meta: input });
    return type;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('LEAVE_TYPE_EXISTS', 'A leave type with that key already exists.');
    throw err;
  }
}

/** Ids of types whose requests only medical reviewers may see. */
const sensitiveIds = async collegeId => (await LeaveType.find({ college: collegeId, sensitive: true }).select('_id').lean()).map(t => t._id);

module.exports = { ensureDefaults, list, dutyType, getActive, save, sensitiveIds };
