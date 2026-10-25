const { Timetable, TimetableEntry } = require('./../models/Timetable');
const { Section, Subject, User, ClassSession, AcademicSession } = require('../models');
const { ROLES, SESSION_STATUS } = require('../config/constants');
const { badRequest, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { isValidISODate, addDays, eachDate, todayISO } = require('../utils/dates');
const { isHHMM, toMinutes, overlaps, slotLabel, isoWeekday } = require('../utils/time');
const audit = require('./auditService');

const FAR = '9999-12-31';
const windowsOverlap = (aFrom, aTo, bFrom, bTo) => aFrom <= (bTo || FAR) && bFrom <= (aTo || FAR);

async function loadTimetable(collegeId, id) {
  const tt = await Timetable.findOne({ _id: id, college: collegeId });
  if (!tt) throw notFound('Timetable not found.');
  return tt;
}

async function assertSectionAllowed(collegeId, sectionId, allowedSectionIds) {
  const section = await Section.findOne({ _id: sectionId, college: collegeId });
  if (!section) throw badRequest('Section not found.', undefined, 'SECTION_NOT_FOUND');
  if (allowedSectionIds && !allowedSectionIds.some(s => String(s) === String(section._id))) {
    throw badRequest('That section is outside your department.', undefined, 'OUT_OF_SCOPE');
  }
  return section;
}

/* -------------------------------------------------------------- conflicts */

/**
 * Clashes for one entry: same teacher, same section or same room at overlapping times on the same weekday
 * in an overlapping effective period. Only approved/archived versions and the entry's own draft count.
 */
async function findConflicts(timetable, entry, excludeEntryId = null) {
  const others = await Timetable.find({
    college: timetable.college, _id: { $ne: timetable._id }, status: { $in: ['approved', 'archived'] }
  }).lean();
  const live = others.filter(o => windowsOverlap(timetable.effectiveFrom, timetable.effectiveTo, o.effectiveFrom, o.effectiveTo)).map(o => o._id);
  const candidates = await TimetableEntry.find({
    college: timetable.college, dayOfWeek: entry.dayOfWeek, _id: { $ne: excludeEntryId },
    $or: [{ timetable: timetable._id }, { timetable: { $in: live } }]
  }).lean();

  const clashes = [];
  for (const c of candidates) {
    if (!overlaps(entry.startTime, entry.endTime, c.startTime, c.endTime)) continue;
    if (String(c.teacher) === String(entry.teacher)) clashes.push({ kind: 'teacher', entryId: String(c._id) });
    if (String(c.section) === String(entry.section)) clashes.push({ kind: 'section', entryId: String(c._id) });
    if (entry.room && c.room && c.room.toLowerCase() === entry.room.toLowerCase()) clashes.push({ kind: 'room', entryId: String(c._id) });
  }
  return clashes;
}

async function validateEntryInput(collegeId, timetable, input) {
  if (!isHHMM(input.startTime) || !isHHMM(input.endTime) || toMinutes(input.startTime) >= toMinutes(input.endTime)) {
    throw badRequest('End time must be after the start time (HH:MM).', undefined, 'INVALID_TIME');
  }
  const subject = await Subject.findOne({ _id: input.subjectId, college: collegeId });
  if (!subject || String(subject.section) !== String(timetable.section)) throw badRequest('The subject does not belong to this section.', undefined, 'SUBJECT_NOT_IN_SECTION');
  const teacherId = input.teacherId || subject.teacher;
  const teacher = teacherId && await User.findOne({ _id: teacherId, college: collegeId, role: ROLES.TEACHER, active: true });
  if (!teacher) throw badRequest('Choose an active teacher for this class.', undefined, 'TEACHER_REQUIRED');
  return { subject, teacher };
}

/* ----------------------------------------------------------- timetable CRUD */

async function createDraft(actor, college, allowedSectionIds, input) {
  const section = await assertSectionAllowed(college._id, input.sectionId, allowedSectionIds);
  const session = await AcademicSession.findOne({ _id: input.academicSessionId, college: college._id });
  if (!session) throw badRequest('Academic session not found.', undefined, 'SESSION_NOT_FOUND');
  if (!isValidISODate(input.effectiveFrom) || (input.effectiveTo && input.effectiveTo < input.effectiveFrom)) throw badRequest('Check the effective dates.', undefined, 'INVALID_RANGE');

  const latest = await Timetable.findOne({ section: section._id, academicSession: session._id }).sort({ version: -1 });
  try {
    const tt = await Timetable.create({
      college: college._id, section: section._id, academicSession: session._id, version: (latest ? latest.version : 0) + 1,
      effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo || null, createdBy: actor._id
    });
    if (latest && input.copyFromLatest !== false) {
      const entries = await TimetableEntry.find({ timetable: latest._id }).lean();
      if (entries.length) await TimetableEntry.insertMany(entries.map(({ _id, createdAt, updatedAt, ...e }) => ({ ...e, timetable: tt._id })));
    }
    await audit.record({ actor, collegeId: college._id, action: 'timetable.created', entityType: 'Timetable', entityId: tt._id, meta: { version: tt.version } });
    return tt;
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('TIMETABLE_VERSION_EXISTS', 'Another draft was created at the same moment. Try again.');
    throw err;
  }
}

async function list(collegeId, { sectionIds, sectionId } = {}) {
  const filter = { college: collegeId };
  if (sectionId) filter.section = sectionId;
  if (sectionIds) filter.section = sectionId ? { $in: sectionIds.filter(s => String(s) === String(sectionId)) } : { $in: sectionIds };
  return Timetable.find(filter).populate('section', 'name sem').populate('academicSession', 'name').sort({ createdAt: -1 }).limit(200).lean();
}

async function detail(collegeId, id) {
  const tt = await loadTimetable(collegeId, id);
  const entries = await TimetableEntry.find({ timetable: tt._id }).populate('subject', 'name code').populate('teacher', 'name').sort({ dayOfWeek: 1, startTime: 1 }).lean();
  return { timetable: tt.toObject(), entries };
}

async function addEntry(actor, college, id, input) {
  const tt = await loadTimetable(college._id, id);
  if (tt.status !== 'draft') throw conflict('TIMETABLE_LOCKED', 'Only draft timetables can be edited. Create a new version instead.');
  const { subject, teacher } = await validateEntryInput(college._id, tt, input);
  const entry = { college: college._id, timetable: tt._id, section: tt.section, subject: subject._id, teacher: teacher._id, dayOfWeek: input.dayOfWeek, startTime: input.startTime, endTime: input.endTime, room: input.room || '' };

  const clashes = await findConflicts(tt, entry);
  if (clashes.length && !input.overrideReason) {
    throw conflict('TIMETABLE_CONFLICT', 'This entry clashes with an existing class. Fix it, or record an explicit override reason.', clashes);
  }
  if (clashes.length) entry.override = { reason: input.overrideReason, by: actor._id, at: new Date() };
  const doc = await TimetableEntry.create(entry);
  await audit.record({ actor, collegeId: college._id, action: clashes.length ? 'timetable.entry_override' : 'timetable.entry_added', entityType: 'Timetable', entityId: tt._id, meta: { entryId: String(doc._id), clashes, reason: input.overrideReason } });
  return doc;
}

async function removeEntry(actor, college, timetableId, entryId) {
  const tt = await loadTimetable(college._id, timetableId);
  if (tt.status !== 'draft') throw conflict('TIMETABLE_LOCKED', 'Only draft timetables can be edited.');
  const res = await TimetableEntry.deleteOne({ _id: entryId, timetable: tt._id });
  if (!res.deletedCount) throw notFound('Entry not found.');
  await audit.record({ actor, collegeId: college._id, action: 'timetable.entry_removed', entityType: 'Timetable', entityId: tt._id, meta: { entryId } });
}

/* ----------------------------------------------------------- generation */

/**
 * Creates the class sessions of every approved/archived timetable version for [from, to].
 * Idempotent: a session is identified by (subject, date, slot), so running it again, or running two copies
 * at once, can never create a duplicate. It reuses an existing ad hoc/legacy session for the same slot
 * (attaching the timetable entry) and revives sessions that an earlier timetable change had cancelled.
 */
async function generate(collegeId, from, to) {
  const timetables = await Timetable.find({ college: collegeId, status: { $in: ['approved', 'archived'] }, effectiveFrom: { $lte: to } }).lean();
  const stats = { created: 0, linked: 0, revived: 0 };
  const dates = eachDate(from, to);

  for (const tt of timetables) {
    const entries = await TimetableEntry.find({ timetable: tt._id }).lean();
    for (const date of dates) {
      if (date < tt.effectiveFrom || (tt.effectiveTo && date > tt.effectiveTo)) continue;
      const weekday = isoWeekday(date);
      for (const e of entries.filter(x => x.dayOfWeek === weekday)) {
        const slot = slotLabel(e.startTime, e.endTime);
        const key = { subject: e.subject, date, slot };
        const fields = { college: collegeId, section: e.section, teacher: e.teacher, startTime: e.startTime, endTime: e.endTime, room: e.room, timetableEntry: e._id };
        try {
          const res = await ClassSession.findOneAndUpdate(key, { $setOnInsert: { ...fields, status: SESSION_STATUS.SCHEDULED, source: 'timetable' } }, { upsert: true, returnDocument: 'after', includeResultMetadata: true });
          if (!res.lastErrorObject.updatedExisting) { stats.created += 1; continue; }
        } catch (err) {
          if (!isDuplicateKey(err)) throw err; // lost an upsert race: the session exists now
        }
        // existed already: revive a session cancelled by a timetable change, or attach the entry to an ad hoc one
        const revived = await ClassSession.updateOne({ ...key, status: SESSION_STATUS.CANCELLED, cancelReason: 'timetable_changed' }, { $set: { ...fields, status: SESSION_STATUS.SCHEDULED, source: 'timetable', cancelReason: '' } });
        if (revived.modifiedCount) { stats.revived += 1; continue; }
        const linked = await ClassSession.updateOne({ ...key, timetableEntry: null }, { $set: { timetableEntry: e._id, startTime: e.startTime, endTime: e.endTime, room: e.room } });
        if (linked.modifiedCount) stats.linked += 1;
      }
    }
  }
  return stats;
}

/** Approval: re-check conflicts, retire the previous version from the new start date, then generate sessions. */
async function approve(actor, college, id, { today = todayISO(college.settings.timezone), horizonDays = 14 } = {}) {
  const tt = await loadTimetable(college._id, id);
  if (tt.status !== 'draft') throw conflict('TIMETABLE_LOCKED', 'This timetable is already approved or archived.');
  const entries = await TimetableEntry.find({ timetable: tt._id }).lean();
  if (!entries.length) throw badRequest('Add at least one class before approving.', undefined, 'EMPTY_TIMETABLE');

  const problems = [];
  for (const e of entries) {
    const clashes = await findConflicts(tt, e, e._id);
    if (clashes.length && !e.override) problems.push({ entryId: String(e._id), clashes });
  }
  if (problems.length) throw conflict('TIMETABLE_CONFLICT', 'Resolve the clashes before approving.', problems);

  // retire previous versions for the same section
  const previous = await Timetable.find({ section: tt.section, college: college._id, status: 'approved', _id: { $ne: tt._id } });
  for (const old of previous) {
    const end = addDays(tt.effectiveFrom, -1);
    old.status = 'archived';
    if (!old.effectiveTo || old.effectiveTo > end) old.effectiveTo = end < old.effectiveFrom ? old.effectiveFrom : end;
    await old.save();
    const oldEntryIds = (await TimetableEntry.find({ timetable: old._id }).select('_id').lean()).map(x => x._id);
    // future classes of the old version that nobody has marked are cancelled (kept for history), not deleted
    await ClassSession.updateMany(
      { college: college._id, timetableEntry: { $in: oldEntryIds }, date: { $gte: tt.effectiveFrom }, status: SESSION_STATUS.SCHEDULED },
      { $set: { status: SESSION_STATUS.CANCELLED, cancelReason: 'timetable_changed' } }
    );
  }

  tt.status = 'approved'; tt.approvedBy = actor._id; tt.approvedAt = new Date();
  await tt.save();
  const from = tt.effectiveFrom > today ? tt.effectiveFrom : today;
  const generated = await generate(college._id, from, addDays(from, horizonDays));
  await audit.record({ actor, collegeId: college._id, action: 'timetable.approved', entityType: 'Timetable', entityId: tt._id, meta: { version: tt.version, generated } });
  return { timetable: tt, generated };
}

/**
 * A student's view: the weekly pattern that is in force today, plus the next 7 days of actual classes so
 * cancellations and room changes show up. Only approved (or since-archived but still effective) timetables count.
 */
async function forStudent({ college, profile }) {
  const today = todayISO(college.settings.timezone);
  const tts = await Timetable.find({ college: college._id, section: profile.section, status: { $in: ['approved', 'archived'] }, effectiveFrom: { $lte: today } }).lean();
  const inForce = tts.filter(t => !t.effectiveTo || t.effectiveTo >= today).sort((a, b) => b.version - a.version).slice(0, 1);
  const [entries, upcoming] = await Promise.all([
    TimetableEntry.find({ timetable: { $in: inForce.map(t => t._id) } }).populate('subject', 'name code').populate('teacher', 'name').sort({ dayOfWeek: 1, startTime: 1 }).lean(),
    ClassSession.find({ college: college._id, section: profile.section, date: { $gte: today, $lte: addDays(today, 6) } }).populate('subject', 'name code').sort({ date: 1, startTime: 1, slot: 1 }).lean()
  ]);
  return {
    week: entries.map(e => ({ dayOfWeek: e.dayOfWeek, startTime: e.startTime, endTime: e.endTime, room: e.room, subject: e.subject && e.subject.name, code: e.subject && e.subject.code, teacher: e.teacher && e.teacher.name })),
    upcoming: upcoming.map(c => ({ date: c.date, slot: c.slot, startTime: c.startTime, endTime: c.endTime, room: c.room, subject: c.subject && c.subject.name, status: c.status, cancelReason: c.status === SESSION_STATUS.CANCELLED ? c.cancelReason : '' }))
  };
}

module.exports = { createDraft, list, detail, addEntry, removeEntry, approve, generate, findConflicts, windowsOverlap, forStudent };
