const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { loadOwnStudent } = require('../middleware/ownership');
const { ROLES, CONSOLE_ROLES } = require('../config/constants');

/**
 * Central route table. Authentication and role/permission checks are declared here, once per
 * area, so no individual route can forget them.
 */
const mentoring = require('./mentoringRoutes');
const facilities = require('./facilitiesRoutes');

module.exports = ({ limiters }) => {
  const router = express.Router();
  const staffConsole = [requireAuth(), requireRole(...CONSOLE_ROLES)];

  router.use('/auth', require('./authRoutes')({ limiters }));
  router.use('/events', require('./eventRoutes'));

  // Administrative console: console roles (admin, hod, accounts_clerk, exam_cell), then a permission per route group.
  router.use('/admin/access', ...staffConsole, require('./accessRoutes'));
  router.use('/admin/system', ...staffConsole, require('./systemRoutes'));
  router.use('/admin/mentoring', ...staffConsole, mentoring.admin);
  router.use('/admin/library', ...staffConsole, facilities.library);
  router.use('/admin/fees', ...staffConsole, require('./feeAdminRoutes'));
  router.use('/admin/data', ...staffConsole, require('./dataRoutes'));
  router.use('/admin/analytics', ...staffConsole, require('./analyticsRoutes'));
  router.use('/admin/exams', ...staffConsole, require('./examRoutes'));
  router.use('/admin', ...staffConsole, require('./adminRoutes'));

  router.use('/timetable', requireAuth(), require('./timetableRoutes'));
  router.use('/mentor', requireAuth(), requireRole(ROLES.TEACHER), mentoring.mentor);
  router.use('/parent', requireAuth(), requireRole(ROLES.PARENT), require('./parentRoutes')({ limiters }));
  router.use('/files', requireAuth(), require('./fileRoutes'));
  router.use('/announcements', requireAuth(), require('./announcementRoutes'));
  router.use('/faculty', requireAuth(), requireRole(ROLES.TEACHER, ROLES.ADMIN), requirePermission('attendance.mark', 'attendance.view', 'attendance.approveCorrection'), require('./facultyRoutes'));
  router.get('/student/qr-attendance/open', requireAuth(), requireRole(ROLES.STUDENT), loadOwnStudent, require('../controllers/qrController').openForStudent);
  router.post('/student/qr-attendance', requireAuth(), requireRole(ROLES.STUDENT), loadOwnStudent, limiters.sensitive, require('../middleware/validate')(require('../validators/qr').scan), require('../controllers/qrController').scan);
  router.use('/student', requireAuth(), requireRole(ROLES.STUDENT), loadOwnStudent, require('./studentRoutes'));
  router.use('/duty-leaves', requireAuth(), require('./dutyLeaveRoutes'));
  router.use('/fees', requireAuth(), requireRole(ROLES.STUDENT), loadOwnStudent, require('./feeRoutes')({ limiters }));

  return router;
};
