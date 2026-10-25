const { College } = require('../models');
const authService = require('../services/authService');
const passwordReset = require('../services/passwordResetService');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/errors');
const { issueToken } = require('../middleware/csrf');
const { ROLE_TITLES, TIME_SLOTS } = require('../config/constants');

const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(e => (e ? reject(e) : resolve())));
const save = req => new Promise((resolve, reject) => req.session.save(e => (e ? reject(e) : resolve())));

const presentUser = (user, college) => ({
  ...user.toPublic(),
  title: ROLE_TITLES[user.role],
  collegeName: college.name,
  collegeCode: college.code
});

/** Public: confirms a college code exists and returns only its display name. */
exports.lookupCollege = asyncHandler(async (req, res) => {
  const college = await College.findOne({ code: req.validatedQuery.code.toUpperCase(), active: true }).select('code name');
  if (!college) throw notFound('College code not recognized.', 'COLLEGE_NOT_FOUND');
  res.json({ data: { code: college.code, name: college.name } });
});

exports.csrf = (req, res) => {
  res.json({ data: { csrfToken: issueToken(req) } });
};

exports.login = asyncHandler(async (req, res) => {
  const { user, college } = await authService.authenticate({ ...req.body, ip: req.ip });
  // New session id on every login prevents session fixation.
  await regenerate(req);
  Object.assign(req.session, {
    userId: String(user._id), collegeId: String(college._id), role: user.role, loginAt: Date.now()
  });
  const csrfToken = issueToken(req);
  await save(req);
  res.json({ data: { user: presentUser(user, college), csrfToken } });
});

exports.logout = asyncHandler(async (req, res) => {
  await new Promise(resolve => req.session.destroy(resolve));
  res.clearCookie('attendx.sid');
  res.json({ data: { ok: true } });
});

exports.me = (req, res) => {
  res.json({
    data: {
      user: { ...presentUser(req.user, req.college), permissions: req.perms.list(), departments: req.perms.departments },
      csrfToken: issueToken(req),
      settings: req.college.settings,
      timeSlots: TIME_SLOTS
    }
  });
};

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await authService.changePassword({ user: req.user, ...req.body, ip: req.ip });
  // Rotate the session and invalidate every other session of this user.
  await regenerate(req);
  Object.assign(req.session, {
    userId: String(user._id), collegeId: String(req.college._id), role: user.role, loginAt: Date.now()
  });
  const csrfToken = issueToken(req);
  await save(req);
  res.json({ data: { ok: true, csrfToken } });
});

/** Always answers the same way, so it cannot be used to find out which addresses are registered. */
exports.forgotPassword = asyncHandler(async (req, res) => {
  await passwordReset.request({ ...req.body, ip: req.ip });
  res.status(202).json({ data: { message: 'If that account exists, a reset link has been sent to its e-mail address.' } });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  await passwordReset.confirm({ ...req.body, ip: req.ip });
  res.json({ data: { ok: true } });
});
