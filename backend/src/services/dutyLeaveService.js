const { DutyLeaveRequest, DutyLeaveDay, Section, StudentProfile, LeaveType } = require('../models');
const { ROLES, DUTY_LEAVE_STATUS: S, DUTY_LEAVE_LIMITS, NOTIFICATION_TYPES } = require('../config/constants');
const { badRequest, forbidden, notFound, conflict } = require('../utils/errors');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { todayISO, diffDays, eachDate } = require('../utils/dates');
const leaveTypes = require('./leaveTypeService');
const alerts = require('./alertService');
const audit = require('./auditService');
const notifications = require('./notificationService');

/**
 * Leave workflow for every leave type (duty, medical, personal and administrator-defined ones).
 * What a type does to attendance, whether it needs a document and who may review it is configuration on the
 * type (see leaveTypeService); the workflow, duplicate protection and audit trail are shared.
 */
const ACTIVE = [S.PENDING, S.APPROVED];

function assertRange({ fromDate, toDate, settings, type }) {
  if (toDate < fromDate) throw badRequest('"To" date cannot be before "From" date.', [{ field: 'toDate', message: 'Before start date.' }], 'INVALID_RANGE');
  const days = diffDays(fromDate, toDate) + 1;
  const cap = Math.min(DUTY_LEAVE_LIMITS.maxRangeDays, type.maxDaysPerRequest || DUTY_LEAVE_LIMITS.maxRangeDays);
  if (days > cap) throw badRequest(`A single ${type.name.toLowerCase()} request can cover at most ${cap} days.`, undefined, 'RANGE_TOO_LONG');
  const today = todayISO(settings.timezone);
  if (diffDays(fromDate, today) > DUTY_LEAVE_LIMITS.maxPastDays) throw badRequest(`Leave can be requested for at most ${DUTY_LEAVE_LIMITS.maxPastDays} days in the past.`, undefined, 'DATE_TOO_OLD');
  if (diffDays(today, toDate) > DUTY_LEAVE_LIMITS.maxFutureDays) throw badRequest(`Leave cannot be requested more than ${DUTY_LEAVE_LIMITS.maxFutureDays} days ahead.`, undefined, 'DATE_TOO_FAR');
}

/** Finds days in the range that already belong to another request (of any leave type), per the college policy. */
async function findConflicts({ studentId, dates, settings }) {
  const blocking = settings.allowResubmitAfterRejection ? ACTIVE : [...ACTIVE, S.REJECTED];
  return DutyLeaveDay.find({ student: studentId, date: { $in: dates }, state: { $in: blocking } })
    .populate({ path: 'request', select: 'fromDate toDate status leaveType', populate: { path: 'leaveType', select: 'name' } }).sort({ date: 1 }).lean();
}

const duplicateError = conflicts => {
  const first = conflicts[0];
  const kind = (first.request && first.request.leaveType && first.request.leaveType.name ? first.request.leaveType.name : 'duty leave').toLowerCase();
  const policyNote = first.state === S.REJECTED ? ' Resubmission after rejection is not permitted by your college.' : '';
  return conflict('DUTY_LEAVE_DUPLICATE',
    `You already have a ${first.state} ${kind} request covering ${first.date}.${policyNote}`,
    conflicts.map(c => ({ date: c.date, status: c.state, requestId: c.request && String(c.request._id) })));
};

/**
 * Submits a leave request. Duplicates are rejected by policy checks AND by a partial unique index on
 * (student, date) over active days, so two simultaneous submissions covering the same date can never
 * both be stored, whatever their leave types.
 */
async function submit({ actor = null, college, profile, fromDate, toDate, reason, file, leaveTypeId }) {
  const settings = college.settings;
  const type = await leaveTypes.getActive(college._id, leaveTypeId);
  assertRange({ fromDate, toDate, settings, type });
  if (type.requiresDocument && !file) throw badRequest(`${type.name} needs a supporting document.`, [{ field: 'document', message: 'Required' }], 'DOCUMENT_REQUIRED');
  const dates = eachDate(fromDate, toDate);

  const existing = await findConflicts({ studentId: profile._id, dates, settings });
  if (existing.length) throw duplicateError(existing);

  const section = await Section.findById(profile.section).select('mentor');
  const request = await DutyLeaveRequest.create({
    college: college._id, student: profile._id, section: profile.section, mentor: section ? section.mentor : null,
    fromDate, toDate, reason, status: S.PENDING, leaveType: type._id,
    document: file ? { storedName: file.filename, originalName: file.originalname.slice(0, 120), mimeType: file.mimetype, size: file.size } : null,
    history: [{ status: S.PENDING, by: profile.user, remark: 'Submitted' }]
  });

  try {
    await DutyLeaveDay.insertMany(
      dates.map(date => ({ college: college._id, student: profile._id, request: request._id, date, state: S.PENDING, active: true, exempt: type.exemptsAttendance })),
      { ordered: true }
    );
  } catch (err) {
    // Roll back: nothing of a rejected submission may remain.
    await DutyLeaveDay.deleteMany({ request: request._id });
    await DutyLeaveRequest.deleteOne({ _id: request._id });
    if (isDuplicateKey(err)) throw duplicateError(await findConflicts({ studentId: profile._id, dates, settings }).then(c => (c.length ? c : [{ date: fromDate, state: S.PENDING }])));
    throw err;
  }

  await audit.record({ actor, collegeId: college._id, action: 'dutyleave.submitted', entityType: 'DutyLeaveRequest', entityId: request._id, meta: { student: String(profile._id), fromDate, toDate, type: type.key } });
  return request;
}

/** Administrators and staff holding leave.review see every request; faculty only those of sections they mentor. */
const seesEverything = (actor, perms) => actor.role === ROLES.HOD || (actor.role !== ROLES.TEACHER && Boolean(perms && perms.can('leave.review')));

const typeOf = async request => (request.leaveType ? LeaveType.findById(request.leaveType).lean() : null);

/**
 * Who may review: sensitive (medical) requests only by holders of leave.reviewMedical, never by faculty mentors;
 * everything else by administrators/staff with leave.review and by the mentor of the student's section.
 */
async function canReview(actor, request, perms) {
  const type = await typeOf(request);
  if (type && type.sensitive) return Boolean(perms && perms.can('leave.reviewMedical'));
  if (seesEverything(actor, perms)) return true;
  if (actor.role !== ROLES.TEACHER) return false;
  if (request.mentor && String(request.mentor) === String(actor._id)) return true;
  return Boolean(await Section.exists({ _id: request.section, mentor: actor._id }));
}

/**
 * Moves a pending request to approved/rejected. The status change is one atomic compare-and-set on
 * `status: pending`, so a second click or concurrent approval can never apply twice. Attendance rows are
 * never touched: approved days of types that exempt attendance are applied when numbers are computed, so
 * repeated approvals cannot create duplicate effects.
 */
async function review({ actor, perms, college, requestId, decision, remark = '' }) {
  const request = await DutyLeaveRequest.findOne({ _id: requestId, college: college._id });
  if (!request) throw notFound('Leave request not found.');
  if (!(await canReview(actor, request, perms))) throw forbidden('You are not allowed to review this request.');
  const type = await typeOf(request);

  const updated = await DutyLeaveRequest.findOneAndUpdate(
    { _id: requestId, status: S.PENDING },
    { $set: { status: decision, reviewedBy: actor._id, reviewedAt: new Date(), remark }, $push: { history: { status: decision, by: actor._id, remark } } },
    { returnDocument: 'after' }
  );
  if (!updated) {
    throw conflict('INVALID_TRANSITION', `This request is already ${request.status} and can no longer be changed.`, { status: request.status });
  }

  await DutyLeaveDay.updateMany({ request: requestId }, { $set: { state: decision, active: decision === S.APPROVED } });
  await audit.record({ actor, collegeId: college._id, action: `dutyleave.${decision}`, entityType: 'DutyLeaveRequest', entityId: requestId, meta: { remark: type && type.sensitive ? undefined : remark } });

  const profile = await StudentProfile.findById(updated.student);
  const label = type ? type.name : 'Duty leave';
  await notifications.notify({
    collegeId: college._id, userId: profile.user, type: NOTIFICATION_TYPES.DUTY_LEAVE,
    title: `${label} ${decision}`,
    // remarks on medical requests stay in the app, out of mail/SMS-adjacent text
    message: `Your ${label.toLowerCase()} request for ${updated.fromDate}${updated.toDate !== updated.fromDate ? ` to ${updated.toDate}` : ''} was ${decision}.${remark && !(type && type.sensitive) ? ` Remark: ${remark}` : ''}`,
    data: { requestId: String(requestId), status: decision }, dedupeKey: `dutyleave:${requestId}:${decision}`
  });
  if (decision === S.APPROVED && (!type || type.exemptsAttendance)) await alerts.evaluateStudent(college, profile);
  return updated;
}

/** A student withdraws their own pending request, releasing the dates. */
async function cancel({ actor = null, college, profile, requestId }) {
  const updated = await DutyLeaveRequest.findOneAndUpdate(
    { _id: requestId, student: profile._id, status: S.PENDING },
    { $set: { status: S.CANCELLED }, $push: { history: { status: S.CANCELLED, by: profile.user, remark: 'Cancelled by student' } } },
    { returnDocument: 'after' }
  );
  if (!updated) {
    const exists = await DutyLeaveRequest.exists({ _id: requestId, student: profile._id });
    if (!exists) throw notFound('Leave request not found.');
    throw conflict('INVALID_TRANSITION', 'Only pending requests can be cancelled.');
  }
  await DutyLeaveDay.updateMany({ request: requestId }, { $set: { state: S.CANCELLED, active: false } });
  await audit.record({ actor, collegeId: college._id, action: 'dutyleave.cancelled', entityType: 'DutyLeaveRequest', entityId: requestId });
  return updated;
}

const POPULATE_STUDENT = { path: 'student', select: 'rollNo user section', populate: [{ path: 'user', select: 'name' }, { path: 'section', select: 'name sem' }] };

async function listForStudent(profile) {
  return DutyLeaveRequest.find({ student: profile._id }).sort({ createdAt: -1 }).limit(200).populate('mentor', 'name').populate('leaveType', 'name key sensitive').lean();
}

/**
 * Review queue: HOD/staff with leave.review see the whole college, a teacher sees the sections they mentor.
 * Requests of sensitive types are removed from the queue of anyone without leave.reviewMedical.
 */
async function listForReviewer({ actor, perms, college, status, skip = 0, limit = 50 }) {
  const filter = { college: college._id };
  if (status) filter.status = status;
  if (!seesEverything(actor, perms)) {
    const sections = await Section.find({ college: college._id, mentor: actor._id }).select('_id');
    filter.section = { $in: sections.map(s => s._id) };
  }
  if (!(perms && perms.can('leave.reviewMedical'))) filter.leaveType = { $nin: await leaveTypes.sensitiveIds(college._id) };
  const [total, rows] = await Promise.all([
    DutyLeaveRequest.countDocuments(filter),
    DutyLeaveRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(POPULATE_STUDENT).populate('leaveType', 'name key sensitive').lean()
  ]);
  return { total, rows };
}

/** Request plus access check, for document downloads. Medical documents: the student and medical reviewers only. */
async function getForViewer({ actor, perms, college, requestId }) {
  const request = await DutyLeaveRequest.findOne({ _id: requestId, college: college._id });
  if (!request) throw notFound('Leave request not found.');
  if (actor.role === ROLES.STUDENT) {
    const profile = await StudentProfile.findOne({ _id: request.student, user: actor._id });
    if (!profile) throw forbidden();
  } else if (!(await canReview(actor, request, perms))) {
    throw forbidden();
  }
  return request;
}

module.exports = { submit, review, cancel, listForStudent, listForReviewer, getForViewer };
