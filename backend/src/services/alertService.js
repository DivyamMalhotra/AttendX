const { AttendanceAlert, Subject, StudentProfile, College } = require('../models');
const { NOTIFICATION_TYPES } = require('../config/constants');
const { isDuplicateKey } = require('../utils/mongoErrors');
const math = require('../utils/attendanceMath');
const stats = require('./attendanceStatsService');
const notifications = require('./notificationService');

const keyFor = (subject, cycle) => `shortage:${subject._id}:${cycle}`;

function shortageMessage(subjectName, s, threshold, needed) {
  const base = `Your attendance in ${subjectName} is ${s.percentage}% (${s.attended} of ${s.eligible} classes), below the required ${threshold}%.`;
  if (needed === null) return `${base} The threshold can no longer be reached.`;
  return `${base} Attend the next ${needed} class${needed === 1 ? '' : 'es'} in a row to reach ${threshold}%.`;
}

/**
 * Brings the stored shortage state of one student/subject in line with the numbers.
 * Idempotent: running it repeatedly with unchanged numbers writes nothing new.
 *  - newly below threshold  -> opens an alert and sends ONE notification
 *  - still below            -> refreshes the numbers in place (no new notification)
 *  - back at/above          -> resolves the alert and sends ONE "recovered" notification
 */
async function syncOne(profile, subject, summary, settings) {
  const threshold = settings.attendanceThreshold;
  const below = math.isBelowThreshold(summary.attended, summary.eligible, threshold);
  const numbers = { attended: summary.attended, eligible: summary.eligible, percentage: summary.percentage, threshold, lastEvaluatedAt: new Date() };
  const needed = below ? math.classesNeededToReach(summary.attended, summary.eligible, threshold) : 0;
  const filter = { student: profile._id, subject: subject._id };

  if (below) {
    let alert = await AttendanceAlert.findOneAndUpdate({ ...filter, status: 'active' }, { $set: numbers }, { returnDocument: 'after' });
    if (alert) {
      await notifications.refresh(profile.user, keyFor(subject, alert.cycle), {
        message: shortageMessage(subject.name, summary, threshold, needed),
        data: { subjectId: String(subject._id), ...numbers }
      });
      return { changed: false, alert };
    }

    // No active alert: reopen a resolved one (next cycle) or create the first one.
    alert = await AttendanceAlert.findOneAndUpdate(
      { ...filter, status: 'resolved' },
      { $set: { ...numbers, status: 'active', openedAt: new Date(), resolvedAt: null }, $inc: { cycle: 1 } },
      { returnDocument: 'after' }
    );
    if (!alert) {
      try {
        alert = await AttendanceAlert.create({ college: profile.college, ...filter, status: 'active', cycle: 1, ...numbers });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        return { changed: false, alert: await AttendanceAlert.findOne(filter) }; // concurrent writer won
      }
    }
    await notifications.notify({
      collegeId: profile.college, userId: profile.user, type: NOTIFICATION_TYPES.ATTENDANCE_SHORTAGE,
      title: `Attendance shortage: ${subject.name}`,
      message: shortageMessage(subject.name, summary, threshold, needed),
      data: { subjectId: String(subject._id), ...numbers },
      dedupeKey: keyFor(subject, alert.cycle)
    });
    return { changed: true, alert };
  }

  const resolved = await AttendanceAlert.findOneAndUpdate(
    { ...filter, status: 'active' },
    { $set: { ...numbers, status: 'resolved', resolvedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (resolved) {
    await notifications.notify({
      collegeId: profile.college, userId: profile.user, type: NOTIFICATION_TYPES.ATTENDANCE_RECOVERED,
      title: `Attendance recovered: ${subject.name}`,
      message: `Your attendance in ${subject.name} is now ${summary.percentage}%, at or above the required ${threshold}%.`,
      data: { subjectId: String(subject._id), ...numbers },
      dedupeKey: `${keyFor(subject, resolved.cycle)}:resolved`
    });
    return { changed: true, alert: resolved };
  }
  return { changed: false, alert: null };
}

/**
 * Re-evaluates students (default: the whole section of the given subjects) after any change
 * that can move attendance: marking/correcting attendance, duty leave decisions, policy changes.
 */
async function evaluate({ college, profiles, subjectIds }) {
  if (!profiles.length) return;
  const settings = college.settings;
  const subjectFilter = subjectIds ? { _id: { $in: subjectIds } } : { section: { $in: [...new Set(profiles.map(p => String(p.section)))] } };
  const subjects = await Subject.find({ college: college._id, ...subjectFilter }).lean();
  const result = await stats.computeStats({
    collegeId: college._id, studentIds: profiles.map(p => p._id), subjectIds: subjects.map(s => s._id), settings
  });

  for (const profile of profiles) {
    for (const subject of subjects) {
      if (String(subject.section) !== String(profile.section)) continue;
      await syncOne(profile, subject, result.get(profile._id, subject._id), settings);
    }
  }
}

/** Evaluate every active student in one subject's section (after attendance for that subject changed). */
async function evaluateSubject(college, subject) {
  const profiles = await StudentProfile.find({ section: subject.section, active: true });
  await evaluate({ college, profiles, subjectIds: [subject._id] });
}

async function evaluateStudent(college, profile) {
  await evaluate({ college, profiles: [profile] });
}

/** Full re-evaluation of a college (threshold/policy change and the periodic job). */
async function evaluateCollege(collegeId) {
  const college = await College.findById(collegeId);
  if (!college) return 0;
  const profiles = await StudentProfile.find({ college: collegeId, active: true });
  const bySection = new Map();
  profiles.forEach(p => bySection.set(String(p.section), [...(bySection.get(String(p.section)) || []), p]));
  for (const group of bySection.values()) await evaluate({ college, profiles: group });
  return profiles.length;
}

/** Active shortage alerts for admin monitoring. */
async function listActive(collegeId, { skip = 0, limit = 50, sectionIds = null } = {}) {
  const filter = { college: collegeId, status: 'active' };
  if (sectionIds) {
    // department-scoped viewers (HOD): only students of their own sections
    const inScope = await StudentProfile.find({ college: collegeId, section: { $in: sectionIds } }).select('_id').lean();
    filter.student = { $in: inScope.map(s => s._id) };
  }
  const [total, rows] = await Promise.all([
    AttendanceAlert.countDocuments(filter),
    AttendanceAlert.find(filter).sort({ percentage: 1 }).skip(skip).limit(limit)
      .populate({ path: 'student', select: 'rollNo section user', populate: [{ path: 'user', select: 'name' }, { path: 'section', select: 'name sem' }] })
      .populate('subject', 'name code').lean()
  ]);
  return { total, rows };
}

module.exports = { evaluate, evaluateSubject, evaluateStudent, evaluateCollege, listActive, syncOne };
