const { Hostel, HostelRoom, HostelAllocation } = require('../models/Facilities');
const { StudentProfile } = require('../models');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { todayISO } = require('../utils/dates');
const { normalizeRollNo } = require('../utils/rollNumber');
const charges = require('./chargeService');
const audit = require('./auditService');

const ACTIVE = ['allocated', 'checked_in'];

/* ------------------------------------------------------------------ set-up */

async function saveHostel({ actor, college, id, input }) {
  try {
    let hostel;
    if (id) {
      hostel = await Hostel.findOne({ _id: id, college: college._id });
      if (!hostel) throw notFound('Hostel not found.');
      Object.assign(hostel, input);
      await hostel.save();
    } else {
      hostel = await Hostel.create({ college: college._id, ...input });
    }
    await audit.record({ actor, collegeId: college._id, action: id ? 'hostel.updated' : 'hostel.created', entityType: 'Hostel', entityId: hostel._id, meta: input });
    return hostel;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('HOSTEL_EXISTS', 'A hostel with that code already exists.');
    throw err;
  }
}

/** Adds rooms in bulk: [{ floor, numbers: ['101','102'], capacity }]. Existing room numbers are left untouched. */
async function addRooms({ actor, college, hostelId, groups }) {
  const hostel = await Hostel.findOne({ _id: hostelId, college: college._id });
  if (!hostel) throw notFound('Hostel not found.');
  const ops = groups.flatMap(g => g.numbers.map(number => ({
    updateOne: { filter: { hostel: hostel._id, number }, update: { $setOnInsert: { college: college._id, hostel: hostel._id, floor: g.floor, number, capacity: g.capacity, occupied: 0, active: true } }, upsert: true }
  })));
  const res = await HostelRoom.bulkWrite(ops, { ordered: false });
  await audit.record({ actor, collegeId: college._id, action: 'hostel.rooms_added', entityType: 'Hostel', entityId: hostel._id, meta: { created: res.upsertedCount } });
  return { created: res.upsertedCount, existing: ops.length - res.upsertedCount };
}

async function updateRoom({ actor, college, roomId, input }) {
  const room = await HostelRoom.findOne({ _id: roomId, college: college._id });
  if (!room) throw notFound('Room not found.');
  if (input.capacity !== undefined && input.capacity < room.occupied) throw conflict('CAPACITY_BELOW_OCCUPANCY', `${room.occupied} students currently live in this room.`);
  if (input.active === false && room.occupied > 0) throw conflict('ROOM_OCCUPIED', 'Move the students out before closing this room.');
  Object.assign(room, input);
  await room.save();
  await audit.record({ actor, collegeId: college._id, action: 'hostel.room_updated', entityType: 'HostelRoom', entityId: roomId, meta: input });
  return room;
}

async function listHostels(collegeId) {
  const [hostels, totals] = await Promise.all([
    Hostel.find({ college: collegeId }).populate('warden', 'name').sort({ name: 1 }).lean(),
    HostelRoom.aggregate([{ $match: { college: collegeId, active: true } }, { $group: { _id: '$hostel', rooms: { $sum: 1 }, capacity: { $sum: '$capacity' }, occupied: { $sum: '$occupied' } } }])
  ]);
  const by = new Map(totals.map(t => [String(t._id), t]));
  return hostels.map(h => ({ ...h, rooms: by.get(String(h._id))?.rooms || 0, capacity: by.get(String(h._id))?.capacity || 0, occupied: by.get(String(h._id))?.occupied || 0 }));
}

const roomsOf = (collegeId, hostelId) => HostelRoom.find({ college: collegeId, hostel: hostelId }).sort({ floor: 1, number: 1 }).lean();

/* -------------------------------------------------------------- allocation */

async function student(college, { studentId, rollNo }) {
  const profile = studentId
    ? await StudentProfile.findOne({ _id: studentId, college: college._id })
    : await StudentProfile.findOne({ college: college._id, rollNo: normalizeRollNo(rollNo) });
  if (!profile || !profile.active) throw badRequest('Student not found or not active.', undefined, 'STUDENT_NOT_FOUND');
  return profile;
}

/** One free bed in an active room of an active hostel, claimed with a guarded atomic increment. */
async function claimBed(college, roomId) {
  const room = await HostelRoom.findOne({ _id: roomId, college: college._id, active: true }).lean();
  if (!room) throw notFound('Room not found.');
  const hostel = await Hostel.findOne({ _id: room.hostel, active: true }).lean();
  if (!hostel) throw conflict('HOSTEL_CLOSED', 'That hostel is not accepting allocations.');
  const claimed = await HostelRoom.findOneAndUpdate({ _id: roomId, active: true, $expr: { $lt: ['$occupied', '$capacity'] } }, { $inc: { occupied: 1 } }, { returnDocument: 'after' });
  if (!claimed) throw conflict('ROOM_FULL', 'That room is full.');
  return { room: claimed, hostel };
}

const releaseBed = roomId => HostelRoom.updateOne({ _id: roomId, occupied: { $gt: 0 } }, { $inc: { occupied: -1 } });

/**
 * Allocates a student to a room. Capacity can never be exceeded, even with simultaneous requests, and a student can
 * hold only one active bed (unique index); history is kept in allocation records, never overwritten.
 */
async function allocate({ actor, college, studentRef, roomId, from, charge }) {
  const profile = await student(college, studentRef);
  const { room, hostel } = await claimBed(college, roomId);
  let alloc;
  try {
    alloc = await HostelAllocation.create({ college: college._id, hostel: hostel._id, room: room._id, student: profile._id, from: from || todayISO(college.settings.timezone), createdBy: actor._id });
  } catch (err) {
    await releaseBed(room._id);
    if (isDuplicateKey(err)) throw conflict('ALREADY_ALLOCATED', 'This student already has a bed. Transfer or end that allocation first.');
    throw err;
  }
  if (charge && hostel.feePerTermPaise > 0) {
    const { charge: c } = await charges.createCharge({
      actor, college, studentId: profile._id, category: 'hostel', description: `Hostel fee: ${hostel.name}`, amountPaise: hostel.feePerTermPaise, source: { kind: 'hostel_allocation', id: alloc._id }
    });
    alloc.charge = c._id; await alloc.save();
  }
  await audit.record({ actor, collegeId: college._id, action: 'hostel.allocated', entityType: 'HostelAllocation', entityId: alloc._id, meta: { room: room.number, hostel: hostel.code } });
  return alloc;
}

async function checkIn({ actor, college, id }) {
  const a = await HostelAllocation.findOneAndUpdate({ _id: id, college: college._id, status: 'allocated' }, { $set: { status: 'checked_in', checkedInAt: new Date() } }, { returnDocument: 'after' });
  if (!a) throw conflict('INVALID_TRANSITION', 'Only an allocated (not yet checked in) bed can be checked in.');
  await audit.record({ actor, collegeId: college._id, action: 'hostel.checked_in', entityType: 'HostelAllocation', entityId: id });
  return a;
}

/** Check-out / end of stay. Idempotent: the bed is released only by the call that ends the allocation. */
async function end({ actor, college, id, reason }) {
  const a = await HostelAllocation.findOneAndUpdate({ _id: id, college: college._id, status: { $in: ACTIVE } },
    { $set: { status: 'ended', to: todayISO(college.settings.timezone), checkedOutAt: new Date(), endedBy: actor._id, endReason: reason || '' } }, { returnDocument: 'after' });
  if (!a) throw conflict('INVALID_TRANSITION', 'That allocation is not active.');
  await releaseBed(a.room);
  await audit.record({ actor, collegeId: college._id, action: 'hostel.ended', entityType: 'HostelAllocation', entityId: id, meta: { reason } });
  return a;
}

/** Moves a student to another room: the new bed is secured first, then the old one is released (compensating on failure). */
async function transfer({ actor, college, id, toRoomId, reason }) {
  const current = await HostelAllocation.findOne({ _id: id, college: college._id, status: { $in: ACTIVE } });
  if (!current) throw conflict('INVALID_TRANSITION', 'That allocation is not active.');
  if (String(current.room) === String(toRoomId)) throw badRequest('The student is already in that room.', undefined, 'SAME_ROOM');
  const { room, hostel } = await claimBed(college, toRoomId);
  const ended = await HostelAllocation.findOneAndUpdate({ _id: id, status: { $in: ACTIVE } }, { $set: { status: 'ended', to: todayISO(college.settings.timezone), endedBy: actor._id, endReason: reason || 'Transferred' } }, { returnDocument: 'after' });
  if (!ended) { await releaseBed(room._id); throw conflict('INVALID_TRANSITION', 'The allocation changed while transferring.'); }
  try {
    const next = await HostelAllocation.create({ college: college._id, hostel: hostel._id, room: room._id, student: ended.student, from: todayISO(college.settings.timezone), transferredFrom: ended._id, createdBy: actor._id, status: ended.status === 'checked_in' ? 'checked_in' : 'allocated' });
    await releaseBed(ended.room);
    await audit.record({ actor, collegeId: college._id, action: 'hostel.transferred', entityType: 'HostelAllocation', entityId: next._id, meta: { from: String(ended.room), to: String(room._id), reason } });
    return next;
  } catch (err) {
    // put everything back the way it was
    await releaseBed(room._id);
    await HostelAllocation.updateOne({ _id: ended._id }, { $set: { status: current.status }, $unset: { to: 1, endedBy: 1, endReason: 1 } });
    throw err;
  }
}

async function allocations({ college, status, hostelId, skip = 0, limit = 100 }) {
  const filter = { college: college._id, ...(status === 'active' ? { status: { $in: ACTIVE } } : status ? { status } : {}), ...(hostelId ? { hostel: hostelId } : {}) };
  const [total, rows] = await Promise.all([
    HostelAllocation.countDocuments(filter),
    HostelAllocation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('hostel', 'name code').populate('room', 'number floor')
      .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).lean()
  ]);
  return { total, rows };
}

const forStudent = studentId => HostelAllocation.find({ student: studentId }).sort({ createdAt: -1 }).limit(30).populate('hostel', 'name code type').populate('room', 'number floor').lean();

module.exports = { saveHostel, addRooms, updateRoom, listHostels, roomsOf, allocate, checkIn, end, transfer, allocations, forStudent };
