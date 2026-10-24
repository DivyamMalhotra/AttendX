const stats = require('../services/attendanceStatsService');
const notifications = require('../services/notificationService');
const students = require('../services/studentService');
const asyncHandler = require('../utils/asyncHandler');
const { Section, AttendanceAlert, DutyLeaveRequest } = require('../models');
const { parsePagination } = require('../utils/pagination');

const profileView = async (req) => {
  const section = await Section.findById(req.student.section).populate('mentor', 'name').lean();
  const user = req.user;
  return {
    id: String(req.student._id), name: user.name, email: user.email, rollNo: req.student.rollNo, phone: req.student.phone,
    admissionYear: req.student.admissionYear,
    section: section && { id: String(section._id), name: section.name, sem: section.sem, course: section.course, specialization: section.specialization, semesterNumber: section.semesterNumber },
    mentor: section && section.mentor ? section.mentor.name : null
  };
};

exports.profile = asyncHandler(async (req, res) => res.json({ data: await profileView(req) }));

exports.updateProfile = asyncHandler(async (req, res) => {
  await students.updateOwnProfile(req.student, req.body);
  res.json({ data: await profileView(req) });
});

/** Subject-wise attendance, overall summary and the live shortage alerts. */
exports.attendance = asyncHandler(async (req, res) =>
  res.json({ data: await stats.studentOverview(req.student, req.college.settings) }));

/** Everything the student dashboard needs in one call. */
exports.dashboard = asyncHandler(async (req, res) => {
  const [overview, unread, alertHistory, pendingLeaves, profile] = await Promise.all([
    stats.studentOverview(req.student, req.college.settings),
    notifications.unreadCount(req.user._id),
    AttendanceAlert.find({ student: req.student._id }).populate('subject', 'name').sort({ updatedAt: -1 }).limit(10).lean(),
    DutyLeaveRequest.countDocuments({ student: req.student._id, status: 'pending' }),
    profileView(req)
  ]);
  res.json({ data: { profile, attendance: overview, unreadNotifications: unread, pendingDutyLeaves: pendingLeaves,
    alertHistory: alertHistory.map(a => ({ subject: a.subject && a.subject.name, status: a.status, percentage: a.percentage, openedAt: a.openedAt, resolvedAt: a.resolvedAt })) } });
});

exports.notifications = asyncHandler(async (req, res) => {
  const { skip, limit } = parsePagination(req.validatedQuery, { defaultLimit: 30 });
  const result = await notifications.list(req.user._id, { skip, limit, unreadOnly: req.validatedQuery.unread === 'true' });
  res.json({ data: result.rows, meta: { total: result.total, unread: result.unread } });
});

exports.markRead = asyncHandler(async (req, res) => {
  await notifications.markRead(req.user._id, req.params.id);
  res.json({ data: { ok: true } });
});

exports.markAllRead = asyncHandler(async (req, res) => {
  await notifications.markAllRead(req.user._id);
  res.json({ data: { ok: true } });
});
