const router = require('express').Router();
const student = require('../controllers/studentController');
const duty = require('../controllers/dutyLeaveController');
const validate = require('../middleware/validate');
const { singleDocument } = require('../middleware/upload');
const dv = require('../validators/dutyLeave');
const sv = require('../validators/student');

/** Mounted at /api/student behind requireAuth + requireRole(student) + loadOwnStudent. */
const examCtrl = require('../controllers/examController');
const ev = require('../validators/exams');
const asg = require('../controllers/assignmentController');
const av = require('../validators/assignments');
const { uploadFiles, TYPE_SETS } = require('../middleware/upload');

router.get('/dashboard', student.dashboard);
const timeline = require('../services/timelineService');
const mv = require('../validators/mentoring');
router.get('/timeline', validate(mv.timelineQuery), async (req, res, next) => {
  try { res.json({ data: await timeline.forStudent({ college: req.college, profile: req.student, viewer: 'self', ...req.validatedQuery }) }); } catch (e) { next(e); }
});
const facilities = require('../controllers/facilitiesController');
router.get('/timetable', async (req, res, next) => {
  try { res.json({ data: await require('../services/timetableService').forStudent({ college: req.college, profile: req.student }) }); } catch (e) { next(e); }
});
router.get('/library', facilities.myLoans);
router.get('/assignments', asg.myAssignments);
router.post('/assignments/:id/submit', uploadFiles('submissions', { maxFiles: 3, types: TYPE_SETS.coursework }), validate(av.submit), asg.submit);
router.get('/materials', validate(av.materialList), asg.myMaterials);
router.get('/results', examCtrl.myResults);
router.get('/report-card', validate(ev.reportCard), examCtrl.myReportCard);
router.get('/attendance', student.attendance);
router.get('/profile', student.profile);
router.patch('/profile', validate(sv.profileUpdate), student.updateProfile);

router.get('/notifications', validate(sv.notificationList), student.notifications);
router.post('/notifications/read-all', student.markAllRead);
router.post('/notifications/:id/read', validate(sv.notificationParam), student.markRead);

router.get('/leave-types', require('../controllers/leaveTypeController').forStudent);
router.get('/duty-leaves', duty.mine);
router.post('/duty-leaves', singleDocument('duty-leave'), validate(dv.create), duty.create);
router.post('/duty-leaves/:requestId/cancel', validate(dv.idParam), duty.cancel);

module.exports = router;
