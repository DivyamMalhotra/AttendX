const { FeeStructure, FeeAssignment, AcademicSession } = require('../models');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { sumComponents } = require('../utils/feeMath');
const audit = require('./auditService');

const normalizeComponents = components => components.map(c => ({ name: c.name, kind: c.kind || 'other', amountPaise: c.amountPaise }));

function totalOf(components) {
  const total = sumComponents(components);
  if (!Number.isSafeInteger(total) || total <= 0) throw badRequest('The fee structure must total more than zero.', undefined, 'INVALID_TOTAL');
  return total;
}

async function create(actor, collegeId, input) {
  const session = await AcademicSession.findOne({ _id: input.academicSessionId, college: collegeId });
  if (!session) throw badRequest('Academic session not found.', undefined, 'SESSION_NOT_FOUND');
  const components = normalizeComponents(input.components);
  try {
    const structure = await FeeStructure.create({
      college: collegeId, course: input.course, specialization: input.specialization || '',
      academicSession: session._id, semesterNumber: input.semesterNumber, components,
      totalPaise: totalOf(components), dueDate: input.dueDate || null, updatedBy: actor._id
    });
    await audit.record({ actor, collegeId, action: 'fee_structure.created', entityType: 'FeeStructure', entityId: structure._id, meta: { total: structure.totalPaise } });
    return structure;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('FEE_STRUCTURE_EXISTS', 'A fee structure for that course, session and semester already exists.');
    throw err;
  }
}

/**
 * Editing a structure only changes what is assigned from now on. Students who already
 * hold an assignment keep the snapshot they were charged (see FeeAssignment), so
 * historical financial records are never rewritten.
 */
async function update(actor, collegeId, id, input) {
  const structure = await FeeStructure.findOne({ _id: id, college: collegeId });
  if (!structure) throw notFound('Fee structure not found.');
  const before = { total: structure.totalPaise, version: structure.version };
  if (input.components) {
    structure.components = normalizeComponents(input.components);
    structure.totalPaise = totalOf(structure.components);
  }
  if (input.dueDate !== undefined) structure.dueDate = input.dueDate;
  structure.version += 1;
  structure.updatedBy = actor._id;
  await structure.save();
  await audit.record({ actor, collegeId, action: 'fee_structure.updated', entityType: 'FeeStructure', entityId: id, meta: { before, after: { total: structure.totalPaise, version: structure.version } } });
  return structure;
}

async function list(collegeId) {
  const [structures, counts] = await Promise.all([
    FeeStructure.find({ college: collegeId }).populate('academicSession', 'name isCurrent').sort({ createdAt: -1 }).lean(),
    FeeAssignment.aggregate([{ $match: { college: collegeId } }, { $group: { _id: '$structure', n: { $sum: 1 } } }])
  ]);
  const byStructure = new Map(counts.map(c => [String(c._id), c.n]));
  return structures.map(s => ({ ...s, assignedCount: byStructure.get(String(s._id)) || 0 }));
}

async function remove(actor, collegeId, id) {
  const structure = await FeeStructure.findOne({ _id: id, college: collegeId });
  if (!structure) throw notFound('Fee structure not found.');
  if (await FeeAssignment.exists({ structure: id })) {
    throw conflict('FEE_STRUCTURE_IN_USE', 'This structure has already been assigned to students and cannot be deleted.');
  }
  await structure.deleteOne();
  await audit.record({ actor, collegeId, action: 'fee_structure.deleted', entityType: 'FeeStructure', entityId: id });
}

module.exports = { create, update, list, remove };
