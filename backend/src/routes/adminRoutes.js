const router = require('express').Router();
const ctrl = require('../controllers/adminController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/admin');
const leaveTypeCtrl = require('../controllers/leaveTypeController');
const lv = require('../validators/leaveTypes');

/** Mounted at /api/admin behind requireAuth + a console role. Each route names the permission it needs. */
router.get('/overview', need('dashboard.view'), ctrl.overview);

router.get('/sections', need('roster.manage', 'students.manage', 'students.view', 'attendance.view', 'fees.view', 'timetable.manage', 'timetable.view', 'exams.configure', 'imports.manage'), ctrl.listSections);
router.post('/sections', need('roster.manage'), validate(v.sectionCreate), ctrl.createSection);
router.patch('/sections/:id', need('roster.manage'), validate(v.sectionUpdate), ctrl.updateSection);
router.delete('/sections/:id', need('roster.manage'), validate({ params: v.id.params }), ctrl.deleteSection);
router.put('/sections/:id/mentor', need('roster.manage'), validate(v.mentor), ctrl.setMentor);
router.post('/sections/:id/subjects', need('roster.manage'), validate(v.subjectCreate), ctrl.createSubject);
router.patch('/subjects/:id', need('roster.manage'), validate(v.subjectUpdate), ctrl.updateSubject);
router.delete('/subjects/:id', need('roster.manage'), validate({ params: v.id.params }), ctrl.deleteSubject);

router.get('/teachers', need('roster.manage', 'timetable.manage', 'exams.configure', 'mentors.manage', 'imports.manage'), ctrl.listTeachers);
router.post('/teachers', need('roster.manage'), validate(v.teacherCreate), ctrl.createTeacher);
router.patch('/teachers/:id', need('roster.manage'), validate(v.teacherUpdate), ctrl.updateTeacher);

router.get('/students', need('students.manage', 'students.view'), validate(v.studentList), ctrl.listStudents);
router.post('/students', need('students.manage'), validate(v.studentCreate), ctrl.createStudent);
router.patch('/students/:id', need('students.manage'), validate(v.studentUpdate), ctrl.updateStudent);

router.get('/settings', need('settings.manage'), ctrl.getSettings);
router.patch('/settings', need('settings.manage'), validate(v.settingsUpdate), ctrl.updateSettings);
router.get('/academic-sessions', need('settings.manage', 'fees.configure', 'fees.view', 'timetable.manage', 'exams.configure', 'analytics.view'), ctrl.listSessions);
router.post('/academic-sessions', need('settings.manage'), validate(v.sessionCreate), ctrl.createSession);
router.post('/academic-sessions/:id/current', need('settings.manage'), validate({ params: v.id.params }), ctrl.setCurrentSession);

router.get('/attendance/report', need('attendance.view'), validate(v.attendanceReportQuery), ctrl.attendanceReport);
router.get('/attendance/alerts', need('attendance.view'), validate(v.pageQuery), ctrl.activeAlerts);
router.get('/leave-types', need('leave.configure', 'leave.review'), leaveTypeCtrl.list);
router.post('/leave-types', need('leave.configure'), validate(lv.create), leaveTypeCtrl.create);
router.patch('/leave-types/:id', need('leave.configure'), validate(lv.update), leaveTypeCtrl.update);
router.get('/audit-log', need('audit.view'), validate(v.auditQuery), ctrl.auditLog);

module.exports = router;
