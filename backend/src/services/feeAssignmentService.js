const { FeeStructure, FeeAssignment, StudentProfile, Section } = require('../models');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { escapeRegex } = require('../utils/pagination');
const { feeStatus } = require('../utils/feeMath');
const { todayISO } = require('../utils/dates');
const audit = require('./auditService');

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Course/specialization on both sides, when set, must agree. */
function assertStructureFits(structure, section) {
  if (section.course && !sameText(section.course, structure.course)) {
    throw badRequest(`Section ${section.name} belongs to course "${section.course}", not "${structure.course}".`, undefined, 'COURSE_MISMATCH');
  }
  if (section.specialization && structure.specialization && !sameText(section.specialization, structure.specialization)) {
    throw badRequest(`Section ${section.name} is in specialization "${section.specialization}", not "${structure.specialization}".`, undefined, 'SPECIALIZATION_MISMATCH');
  }
}

/**
 * Assigns a fee structure to students (explicit ids or a whole section). Students that
 * already hold an assignment for that session and semester are skipped, never overwritten.
 */
async function assign({ actor, college, structureId, studentIds, sectionId }) {
  const structure = await FeeStructure.findOne({ _id: structureId, college: college._id });
  if (!structure) throw notFound('Fee structure not found.');

  const filter = { college: college._id, active: true };
  if (studentIds && studentIds.length) filter._id = { $in: studentIds };
  else if (sectionId) filter.section = sectionId;
  else throw badRequest('Choose a section or specific students.');

  const students = await StudentProfile.find(filter).select('_id section');
  if (!students.length) throw badRequest('No matching active students were found.', undefined, 'NO_STUDENTS');

  const sections = await Section.find({ _id: { $in: [...new Set(students.map(s => String(s.section)))] } });
  sections.forEach(sec => assertStructureFits(structure, sec));

  const docs = students.map(s => ({
    college: college._id, student: s._id, academicSession: structure.academicSession, semesterNumber: structure.semesterNumber,
    structure: structure._id, structureVersion: structure.version, course: structure.course, specialization: structure.specialization,
    components: structure.components.map(c => ({ name: c.name, kind: c.kind, amountPaise: c.amountPaise })),
    grossPaise: structure.totalPaise, totalPayablePaise: structure.totalPaise, paidPaise: 0, dueDate: structure.dueDate
  }));

  let created = 0;
  try {
    const res = await FeeAssignment.insertMany(docs, { ordered: false });
    created = res.length;
  } catch (err) {
    // ordered:false keeps inserting after duplicate-key failures; those students already had a fee.
    created = (err.insertedDocs || []).length;
    const nonDuplicate = (err.writeErrors || []).some(e => e.code !== 11000 && e.err?.code !== 11000);
    if (nonDuplicate) throw err;
  }
  const skipped = students.length - created;
  await audit.record({ actor, collegeId: college._id, action: 'fee.assigned', entityType: 'FeeStructure', entityId: structureId, meta: { created, skipped } });
  return { created, skipped };
}

/**
 * Concessions reduce, charges increase, the amount payable. The change is one atomic
 * update that also refuses to take the payable below what has already been paid.
 */
async function adjust({ actor, college, assignmentId, kind, label, amountPaise }) {
  const delta = kind === 'concession' ? -amountPaise : amountPaise;
  const guard = kind === 'concession'
    ? { $expr: { $gte: [{ $subtract: ['$totalPayablePaise', amountPaise] }, '$paidPaise'] } }
    : {};
  const updated = await FeeAssignment.findOneAndUpdate(
    { _id: assignmentId, college: college._id, ...guard },
    { $inc: { totalPayablePaise: delta }, $push: { adjustments: { kind, label, amountPaise, by: actor._id } } },
    { returnDocument: 'after' }
  );
  if (!updated) {
    if (!(await FeeAssignment.exists({ _id: assignmentId, college: college._id }))) throw notFound('Fee assignment not found.');
    throw conflict('ADJUSTMENT_EXCEEDS_BALANCE', 'A concession cannot reduce the payable amount below what the student has already paid.');
  }
  await audit.record({ actor, collegeId: college._id, action: `fee.${kind}_added`, entityType: 'FeeAssignment', entityId: assignmentId, meta: { label, amountPaise } });
  return updated;
}

async function listAssignments({ college, sectionId, sessionId, semesterNumber, status, q, skip = 0, limit = 50 }) {
  const filter = { college: college._id };
  if (sessionId) filter.academicSession = sessionId;
  if (semesterNumber) filter.semesterNumber = semesterNumber;
  if (sectionId || q) {
    const sf = { college: college._id };
    if (sectionId) sf.section = sectionId;
    if (q) sf.rollNo = new RegExp(escapeRegex(q.toUpperCase().replace(/\s+/g, '')));
    filter.student = { $in: (await StudentProfile.find(sf).select('_id').lean()).map(s => s._id) };
  }
  if (status === 'paid') filter.$expr = { $gte: ['$paidPaise', '$totalPayablePaise'] };
  else if (status === 'unpaid') filter.paidPaise = 0;
  else if (status === 'partial') { filter.paidPaise = { $gt: 0 }; filter.$expr = { $lt: ['$paidPaise', '$totalPayablePaise'] }; }

  const [total, rows] = await Promise.all([
    FeeAssignment.countDocuments(filter),
    FeeAssignment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate({ path: 'student', select: 'rollNo user section', populate: [{ path: 'user', select: 'name' }, { path: 'section', select: 'name sem' }] })
      .populate('academicSession', 'name').lean()
  ]);
  const today = todayISO(college.settings.timezone);
  return { total, rows: rows.map(r => ({ ...r, ...feeStatus(r, today) })) };
}

module.exports = { assign, adjust, listAssignments };
