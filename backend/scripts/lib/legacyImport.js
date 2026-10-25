const { normalizeRollNo, isValidRollNo } = require('../../src/utils/rollNumber');
const { eachDate, isValidISODate } = require('../../src/utils/dates');
const { TIME_SLOTS } = require('../../src/config/constants');

const KEYS = {
  colleges: 'attendx_colleges', users: 'attendx_users', sections: 'attendx_sections', subjects: 'attendx_subjects',
  students: 'attendx_students', sessions: 'attendx_sessions', leaves: 'attendx_leave_requests'
};

const keyOf = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

/** localStorage dumps hold JSON strings per key; accept both stringified and already-parsed values. */
function readTable(dump, key) {
  const raw = dump[key];
  if (raw === undefined || raw === null) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) || [] : raw; } catch (e) { return []; }
}

/**
 * Turns the old browser-only data into an import plan WITHOUT touching any database.
 * Anything ambiguous is reported in `conflicts` and left out of the plan; nothing is merged
 * or guessed. Students sharing a normalized roll number are all held back for an administrator.
 */
function planImport(dump) {
  const t = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, readTable(dump, v)]));
  const conflicts = [];
  const note = (type, detail) => conflicts.push({ type, ...detail });

  const collegeById = new Map(t.colleges.map(c => [c.id, c]));
  const sectionById = new Map();
  const sections = t.sections.filter(s => {
    if (!collegeById.has(s.collegeId)) { note('section_without_college', { legacyId: s.id }); return false; }
    const m = /(\d+)/.exec(s.sem || '');
    s.semesterNumber = m ? Math.min(12, Math.max(1, Number(m[1]))) : 1;
    if (!m) note('semester_not_recognised', { legacyId: s.id, sem: s.sem, assumed: 1 });
    sectionById.set(s.id, s);
    return true;
  });

  const seenEmails = new Set();
  const users = t.users.filter(u => {
    const key = `${u.collegeId}|${String(u.email).toLowerCase()}`;
    if (!collegeById.has(u.collegeId) || !['hod', 'teacher'].includes(u.role)) { note('user_skipped', { legacyId: u.id, role: u.role }); return false; }
    if (seenEmails.has(key)) { note('duplicate_staff_email', { legacyId: u.id, email: u.email }); return false; }
    seenEmails.add(key);
    return true;
  });
  const userById = new Map(users.map(u => [u.id, u]));
  const subjects = t.subjects.filter(s => sectionById.has(s.sectionId));

  // ---- students: group by (college, normalized roll number) ----
  const groups = new Map();
  t.students.forEach(s => {
    const roll = normalizeRollNo(s.rollNo);
    const key = `${s.collegeId}|${roll}`;
    groups.set(key, [...(groups.get(key) || []), { ...s, rollNo: roll }]);
  });
  const students = [];
  const heldBack = new Set();
  groups.forEach((list, key) => {
    if (list.length > 1) {
      list.forEach(s => heldBack.add(s.id));
      note('duplicate_roll_number', {
        college: collegeById.get(list[0].collegeId)?.code, normalizedRollNo: key.split('|')[1],
        students: list.map(s => ({ legacyId: s.id, name: s.name, email: s.email || null, sectionId: s.sectionId })),
        action: 'None imported. Correct the roll numbers in the export file and run the import again.'
      });
      return;
    }
    const s = list[0];
    if (!isValidRollNo(s.rollNo)) { heldBack.add(s.id); note('invalid_roll_number', { legacyId: s.id, rollNo: s.rollNo }); return; }
    if (!sectionById.has(s.sectionId) || !collegeById.has(s.collegeId)) { heldBack.add(s.id); note('student_without_section', { legacyId: s.id }); return; }
    if (!s.email) { heldBack.add(s.id); note('student_without_email', { legacyId: s.id, rollNo: s.rollNo, action: 'Students created in the old HOD screen had no login; add an email to the export.' }); return; }
    const emailKey = `${s.collegeId}|${s.email.toLowerCase()}`;
    if (seenEmails.has(emailKey)) { heldBack.add(s.id); note('duplicate_email', { legacyId: s.id, email: s.email }); return; }
    seenEmails.add(emailKey);
    students.push(s);
  });
  const studentById = new Map(students.map(s => [s.id, s]));

  // ---- sessions: one per (subject, date, slot) ----
  const subjectById = new Map(subjects.map(s => [s.id, s]));
  const seenSessions = new Set();
  let skippedAttendance = 0;
  const sessions = [];
  t.sessions.forEach(s => {
    if (!subjectById.has(s.subjectId) || !isValidISODate(s.date)) { note('session_skipped', { legacyId: s.id }); return; }
    const slot = TIME_SLOTS.includes(s.slot) ? s.slot : TIME_SLOTS[1];
    const key = `${s.subjectId}|${s.date}|${slot}`;
    if (seenSessions.has(key)) {
      note('duplicate_session', { legacyId: s.id, subjectId: s.subjectId, date: s.date, slot, action: 'Kept the first record for this slot; this one was not imported.' });
      return;
    }
    seenSessions.add(key);
    const records = Object.entries(s.attendance || {}).filter(([id, v]) => {
      const ok = studentById.has(id) && ['P', 'A'].includes(v);
      if (!ok) skippedAttendance += 1;
      return ok;
    }).map(([studentId, status]) => ({ studentId, status }));
    sessions.push({ ...s, slot, records });
  });
  if (skippedAttendance) note('attendance_rows_not_imported', { count: skippedAttendance, reason: 'belong to held-back or unknown students' });

  // ---- leave requests: old data allowed overlapping duplicates; keep the earliest, cancel later overlaps ----
  const taken = new Map();   // student|date -> request id
  const leaves = [];
  [...t.leaves].sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0)).forEach(r => {
    if (!studentById.has(r.studentId) || !isValidISODate(r.fromDate) || !isValidISODate(r.toDate) || r.toDate < r.fromDate) {
      note('leave_skipped', { legacyId: r.id }); return;
    }
    const status = { declined: 'rejected', rejected: 'rejected', approved: 'approved', cancelled: 'cancelled', pending: 'pending' }[r.status] || 'pending';
    const days = eachDate(r.fromDate, r.toDate);
    let finalStatus = status;
    if (['pending', 'approved'].includes(status)) {
      const clash = days.find(d => taken.has(`${r.studentId}|${d}`));
      if (clash) {
        finalStatus = 'cancelled';
        note('duplicate_leave', { legacyId: r.id, overlapsWith: taken.get(`${r.studentId}|${clash}`), date: clash, action: 'Imported as cancelled so the dates are not counted twice.' });
      } else days.forEach(d => taken.set(`${r.studentId}|${d}`, r.id));
    }
    leaves.push({ ...r, status: finalStatus, originalStatus: status, days });
  });

  return {
    colleges: t.colleges, sections, subjects, users, students, sessions, leaves, conflicts,
    userById,
    summary: {
      colleges: t.colleges.length, staff: users.length, sections: sections.length, subjects: subjects.length,
      students: students.length, studentsHeldBack: heldBack.size, sessions: sessions.length, leaves: leaves.length, conflicts: conflicts.length
    }
  };
}

/**
 * Writes the plan to MongoDB. Idempotent: existing colleges/users/sections/subjects/sessions are
 * found by natural keys and reused, attendance rows are upserted, so the import can be re-run
 * after fixing the conflicts without creating duplicates.
 */
async function commitImport(plan, { models, hashPassword }) {
  const { College, User, Section, Subject, StudentProfile, ClassSession, Attendance, DutyLeaveRequest, DutyLeaveDay } = models;
  const id = { college: new Map(), user: new Map(), section: new Map(), subject: new Map(), student: new Map(), session: new Map() };
  const stats = { created: {}, reused: {} };
  const count = (kind, created) => { const bag = created ? stats.created : stats.reused; bag[kind] = (bag[kind] || 0) + 1; };

  for (const c of plan.colleges) {
    let doc = await College.findOne({ code: String(c.code).toUpperCase() });
    if (doc) count('college', false); else { doc = await College.create({ code: c.code, name: c.name }); count('college', true); }
    id.college.set(c.id, doc._id);
  }
  for (const u of plan.users) {
    const college = id.college.get(u.collegeId);
    let doc = await User.findOne({ college, email: String(u.email).toLowerCase() });
    if (doc) count('user', false);
    else {
      // legacy passwords were stored in plain text: hash them and force a change at first sign-in
      doc = await User.create({ college, role: u.role, name: u.name, email: u.email, passwordHash: await hashPassword(String(u.password || Math.random())), mustChangePassword: true });
      count('user', true);
    }
    id.user.set(u.id, doc._id);
  }
  for (const s of plan.sections) {
    const college = id.college.get(s.collegeId);
    const nameKey = keyOf(s.name);
    let doc = await Section.findOne({ college, nameKey, semesterNumber: s.semesterNumber });
    if (doc) count('section', false);
    else { doc = await Section.create({ college, name: s.name, nameKey, sem: s.sem, semesterNumber: s.semesterNumber, mentor: id.user.get(s.mentorId) || null }); count('section', true); }
    id.section.set(s.id, doc._id);
  }
  for (const s of plan.subjects) {
    const section = id.section.get(s.sectionId);
    const nameKey = keyOf(s.name);
    let doc = await Subject.findOne({ section, nameKey });
    if (doc) count('subject', false);
    else { doc = await Subject.create({ college: id.college.get(s.collegeId), section, name: s.name, nameKey, teacher: id.user.get(s.teacherId) || null }); count('subject', true); }
    id.subject.set(s.id, doc._id);
  }
  for (const s of plan.students) {
    const college = id.college.get(s.collegeId);
    let user = await User.findOne({ college, email: s.email.toLowerCase() });
    let profile = user ? await StudentProfile.findOne({ user: user._id }) : null;
    if (profile) count('student', false);
    else {
      user = user || await User.create({ college, role: 'student', name: s.name, email: s.email, passwordHash: await hashPassword(String(s.password || Math.random())), mustChangePassword: true });
      profile = await StudentProfile.create({ college, user: user._id, section: id.section.get(s.sectionId), rollNo: s.rollNo });
      count('student', true);
    }
    id.student.set(s.id, profile._id);
  }
  for (const s of plan.sessions) {
    const subject = id.subject.get(s.subjectId);
    const sub = plan.subjects.find(x => x.id === s.subjectId);
    let doc = await ClassSession.findOne({ subject, date: s.date, slot: s.slot });
    if (doc) count('session', false);
    else {
      doc = await ClassSession.create({ college: id.college.get(sub.collegeId), subject, section: id.section.get(sub.sectionId), teacher: id.user.get(s.teacherId) || null, date: s.date, slot: s.slot });
      count('session', true);
    }
    if (s.records.length) {
      await Attendance.bulkWrite(s.records.map(r => ({
        updateOne: {
          filter: { classSession: doc._id, student: id.student.get(r.studentId) },
          update: { $setOnInsert: { college: doc.college, subject, section: doc.section, date: s.date, status: r.status } }, upsert: true
        }
      })));
      const present = await Attendance.countDocuments({ classSession: doc._id, status: 'P' });
      const absent = await Attendance.countDocuments({ classSession: doc._id, status: 'A' });
      await ClassSession.updateOne({ _id: doc._id }, { $set: { counts: { present, absent } } });
    }
    id.session.set(s.id, doc._id);
  }
  for (const r of plan.leaves) {
    const student = id.student.get(r.studentId);
    if (await DutyLeaveRequest.exists({ student, fromDate: r.fromDate, toDate: r.toDate, reason: r.reason })) { count('leave', false); continue; }
    const profile = plan.students.find(x => x.id === r.studentId);
    const doc = await DutyLeaveRequest.create({
      college: id.college.get(profile.collegeId), student, section: id.section.get(profile.sectionId), mentor: id.user.get(r.mentorId) || null,
      fromDate: r.fromDate, toDate: r.toDate, reason: r.reason || 'Imported', status: r.status,
      reviewedAt: r.respondedAt ? new Date(r.respondedAt) : null,
      history: [{ status: 'pending', remark: 'Imported from legacy data', at: new Date(r.requestedAt || Date.now()) },
        ...(r.status !== 'pending' ? [{ status: r.status, remark: r.status !== r.originalStatus ? 'Imported as cancelled: overlapped an earlier request' : 'Legacy decision', at: new Date(r.respondedAt || Date.now()) }] : [])]
    });
    const active = ['pending', 'approved'].includes(r.status);
    await DutyLeaveDay.insertMany(r.days.map(date => ({ college: doc.college, student, request: doc._id, date, state: r.status, active })));
    count('leave', true);
  }
  return stats;
}

module.exports = { planImport, commitImport, KEYS };
