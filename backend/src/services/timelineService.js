const { Attendance, AttendanceAlert, DutyLeaveRequest, FeeAssignment, Payment, Refund, MentorAssignment, AcademicSession } = require('../models');
const { Announcement } = require('../models/Announcement');
const { Exam, MarksEntry } = require('../models/Exam');
const { Assignment, AssignmentSubmission } = require('../models/Assignment');
const leaveTypes = require('./leaveTypeService');
const audience = require('./audienceService');
const { formatINR } = require('../utils/money');

/**
 * Unified, read-only activity timeline. There is no events collection: each entry is derived on demand from the
 * module that owns the record (attendance, leave, fees, results, coursework, announcements...), so it can never
 * disagree with the source and nothing is stored twice.
 *
 * What a viewer receives is decided by `allow` (category -> boolean). Counselling notes and medical leave are never
 * part of a timeline; other viewers (staff, parents) also never get reasons, documents or marks of unpublished work.
 */
const CATEGORIES = ['attendance', 'leave', 'fees', 'payments', 'results', 'assignments', 'announcements', 'mentoring'];
const ISO = d => (d instanceof Date ? d : new Date(d));
const dayStart = d => new Date(`${d}T00:00:00+05:30`);
const dayEnd = d => new Date(`${d}T23:59:59.999+05:30`);

async function attendanceEvents(ctx) {
  const abs = await Attendance.find({ student: ctx.profile._id, status: 'A', createdAt: ctx.range }).populate('subject', 'name').sort({ createdAt: -1 }).limit(ctx.cap).lean();
  const alerts = await AttendanceAlert.find({ student: ctx.profile._id, $or: [{ openedAt: ctx.range }, { resolvedAt: ctx.range }] }).populate('subject', 'name').lean();
  const out = abs.map(a => ({ id: `att:${a._id}`, at: ISO(a.createdAt), category: 'attendance', type: 'absent', title: `Marked absent: ${a.subject ? a.subject.name : 'class'}`, detail: a.date, status: 'absent' }));
  alerts.forEach(a => {
    if (a.openedAt && inRange(a.openedAt, ctx.range)) out.push({ id: `alert:${a._id}:open`, at: ISO(a.openedAt), category: 'attendance', type: 'shortage_alert', title: `Attendance shortage: ${a.subject ? a.subject.name : ''}`, detail: `${a.percentage}% against ${a.threshold}% required`, status: 'active' });
    if (a.resolvedAt && inRange(a.resolvedAt, ctx.range)) out.push({ id: `alert:${a._id}:resolved`, at: ISO(a.resolvedAt), category: 'attendance', type: 'shortage_resolved', title: `Attendance recovered: ${a.subject ? a.subject.name : ''}`, detail: '', status: 'resolved' });
  });
  return out;
}

const inRange = (d, range) => (!range || ((!range.$gte || d >= range.$gte) && (!range.$lt || d < range.$lt) && (!range.$lte || d <= range.$lte)));

async function leaveEvents(ctx) {
  const hidden = ctx.viewer === 'self' ? [] : await leaveTypes.sensitiveIds(ctx.college._id);
  const rows = await DutyLeaveRequest.find({ student: ctx.profile._id, leaveType: { $nin: hidden }, createdAt: ctx.range }).populate('leaveType', 'name').sort({ createdAt: -1 }).limit(ctx.cap).lean();
  const out = [];
  rows.forEach(r => {
    const label = r.leaveType ? r.leaveType.name : 'Duty leave';
    const dates = r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`;
    out.push({ id: `leave:${r._id}:req`, at: ISO(r.createdAt), category: 'leave', type: 'leave_requested', title: `${label} requested`, detail: dates, status: 'requested' });
    if (r.reviewedAt && ['approved', 'rejected'].includes(r.status)) out.push({ id: `leave:${r._id}:dec`, at: ISO(r.reviewedAt), category: 'leave', type: 'leave_decided', title: `${label} ${r.status}`, detail: dates, status: r.status });
  });
  return out;
}

async function feeEvents(ctx) {
  const rows = await FeeAssignment.find({ student: ctx.profile._id, ...(ctx.semester ? { semesterNumber: ctx.semester } : {}), createdAt: ctx.range }).populate('academicSession', 'name').lean();
  const out = [];
  rows.forEach(f => {
    const label = f.category === 'semester' ? `Semester ${f.semesterNumber} fee` : f.description || 'Charge';
    out.push({ id: `fee:${f._id}`, at: ISO(f.createdAt), category: 'fees', type: 'fee_assessed', title: `${label} assessed`, detail: formatINR(f.grossPaise), status: 'assessed' });
    (f.adjustments || []).forEach((a, i) => { if (inRange(a.at, ctx.range)) out.push({ id: `fee:${f._id}:adj${i}`, at: ISO(a.at), category: 'fees', type: a.kind, title: `${a.kind === 'concession' ? 'Concession' : 'Charge'}: ${a.label}`, detail: formatINR(a.amountPaise), status: a.kind }); });
  });
  return out;
}

async function paymentEvents(ctx) {
  const pays = await Payment.find({ student: ctx.profile._id, status: 'success', paidAt: ctx.range }).sort({ paidAt: -1 }).limit(ctx.cap).lean();
  const refunds = Refund ? await Refund.find({ student: ctx.profile._id, status: 'completed', updatedAt: ctx.range }).lean() : [];
  return [
    ...pays.map(p => ({ id: `pay:${p._id}`, at: ISO(p.paidAt), category: 'payments', type: 'payment', title: 'Payment received', detail: `${formatINR(p.amountPaise)}${p.receiptNo ? ` · receipt ${p.receiptNo}` : ''}`, status: 'success' })),
    ...refunds.map(r => ({ id: `refund:${r._id}`, at: ISO(r.updatedAt), category: 'payments', type: 'refund', title: 'Refund completed', detail: formatINR(r.amountPaise), status: 'refunded' }))
  ];
}

async function resultEvents(ctx) {
  const entries = await MarksEntry.find({ student: ctx.profile._id, 'final.state': { $exists: true } }).lean();
  const exams = await Exam.find({ _id: { $in: entries.map(e => e.exam) }, status: 'published', publishedAt: ctx.range, ...(ctx.semester ? { semesterNumber: ctx.semester } : {}) }).populate('subject', 'name').lean();
  const by = new Map(entries.map(e => [String(e.exam), e]));
  return exams.filter(x => by.get(String(x._id)).final.revision === x.revision).map(x => ({
    id: `res:${x._id}:${x.revision}`, at: ISO(x.publishedAt), category: 'results', type: 'result_published',
    title: `Result published: ${x.subject ? x.subject.name : x.name}`, detail: `${x.name} · grade ${by.get(String(x._id)).final.grade || '-'}`, status: 'published'
  }));
}

async function assignmentEvents(ctx) {
  const subs = await AssignmentSubmission.find({ student: ctx.profile._id, $or: [{ submittedAt: ctx.range }, { releasedAt: ctx.range }] }).populate({ path: 'assignment', select: 'title maxMarks' }).limit(ctx.cap).lean();
  const out = [];
  subs.forEach(s => {
    if (!s.assignment) return;
    if (inRange(s.submittedAt, ctx.range)) out.push({ id: `sub:${s._id}:${s.attempt}`, at: ISO(s.submittedAt), category: 'assignments', type: 'submitted', title: `Submitted: ${s.assignment.title}`, detail: s.late ? 'Submitted late' : '', status: s.late ? 'late' : 'submitted' });
    if (s.releasedAt && inRange(s.releasedAt, ctx.range)) out.push({ id: `sub:${s._id}:graded`, at: ISO(s.releasedAt), category: 'assignments', type: 'graded', title: `Graded: ${s.assignment.title}`, detail: `${s.marks}/${s.assignment.maxMarks}`, status: 'graded' });
  });
  return out;
}

async function announcementEvents(ctx) {
  const rows = await Announcement.find({ college: ctx.college._id, status: 'published', priority: { $in: ['high', 'urgent'] }, publishedAt: ctx.range }).sort({ publishedAt: -1 }).limit(ctx.cap).lean();
  const mine = await audience.contextFor({ _id: ctx.profile.user, role: 'student', college: ctx.college._id });
  return rows.filter(a => audience.matches(a.audience, mine)).map(a => ({ id: `ann:${a._id}`, at: ISO(a.publishedAt), category: 'announcements', type: 'announcement', title: a.title, detail: a.priority, status: 'published' }));
}

async function mentoringEvents(ctx) {
  const rows = await MentorAssignment.find({ student: ctx.profile._id, from: ctx.range }).populate('mentor', 'name').lean();
  return rows.map(m => ({ id: `mentor:${m._id}`, at: ISO(m.from), category: 'mentoring', type: 'mentor_assigned', title: `Mentor assigned: ${m.mentor ? m.mentor.name : ''}`, detail: '', status: 'assigned' }));
}

const LOADERS = { attendance: attendanceEvents, leave: leaveEvents, fees: feeEvents, payments: paymentEvents, results: resultEvents, assignments: assignmentEvents, announcements: announcementEvents, mentoring: mentoringEvents };

/**
 * @param viewer 'self' | 'staff' | 'parent'
 * @param allow  optional { category: boolean } overrides (parents: college visibility settings)
 */
async function forStudent({ college, profile, viewer = 'self', from, to, categories, sessionId, semester, before, limit = 50, allow }) {
  let range = {};
  if (sessionId) {
    const s = await AcademicSession.findOne({ _id: sessionId, college: college._id }).lean();
    if (s) { range.$gte = dayStart(s.startDate); range.$lte = dayEnd(s.endDate); }
  }
  if (from) range.$gte = dayStart(from);
  if (to) range.$lte = dayEnd(to);
  if (before) range.$lt = new Date(before);
  if (!Object.keys(range).length) range = { $gte: new Date(0) };   // never undefined: `{ field: undefined }` would match nothing

  const wanted = (categories && categories.length ? categories : CATEGORIES).filter(c => LOADERS[c] && (!allow || allow[c] !== false));
  const ctx = { college, profile, viewer, range, semester, cap: Math.min(200, limit * 3) };
  const sets = await Promise.all(wanted.map(c => LOADERS[c](ctx)));
  const merged = sets.flat().sort((a, b) => b.at - a.at);
  const page = merged.slice(0, limit);
  return { events: page, nextBefore: merged.length > limit ? page[page.length - 1].at.toISOString() : null, categories: wanted };
}

module.exports = { forStudent, CATEGORIES };
