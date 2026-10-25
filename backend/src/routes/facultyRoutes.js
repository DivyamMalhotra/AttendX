const router = require('express').Router();
const ctrl = require('../controllers/facultyController');
const validate = require('../middleware/validate');
const { requireSubjectAccess } = require('../middleware/ownership');
const v = require('../validators/attendance');
const tv = require('../validators/timetable');
const tt = require('../controllers/timetableController');
const examCtrl = require('../controllers/examController');
const ev = require('../validators/exams');
const asg = require('../controllers/assignmentController');
const av = require('../validators/assignments');
const { uploadFiles, TYPE_SETS } = require('../middleware/upload');
const { requirePermission: need } = require('../middleware/permissions');

/** Mounted at /api/faculty behind requireAuth + requireRole(teacher, hod). */
router.get('/subjects', ctrl.subjects);

// Examinations assigned to the faculty member: marks entry, drafts, submission for review.
// Assignments and study material for the subjects this teacher teaches.
const coursework = kind => uploadFiles(kind, { field: 'files', maxFiles: 5, types: TYPE_SETS.coursework });
router.get('/assignments', need('assignments.manage'), asg.list);
router.post('/assignments', need('assignments.manage'), coursework('assignments'), validate(av.create), asg.create);
router.patch('/assignments/:id', need('assignments.manage'), validate(av.update), asg.update);
router.post('/assignments/:id/publish', need('assignments.manage'), validate(av.id), asg.publish);
router.post('/assignments/:id/close', need('assignments.manage'), validate(av.id), asg.close);
router.get('/assignments/:id/submissions', need('assignments.manage'), validate(av.id), asg.submissions);
router.put('/assignments/:id/submissions/:studentId/grade', need('assignments.manage'), validate(av.grade), asg.grade);
router.post('/assignments/:id/release', need('assignments.manage'), validate(av.id), asg.release);
router.get('/materials', need('assignments.manage'), validate(av.materialList), asg.materials);
router.post('/materials', need('assignments.manage'), uploadFiles('materials', { maxFiles: 1, types: TYPE_SETS.coursework }), validate(av.material), asg.addMaterial);
router.delete('/materials/:id', need('assignments.manage'), validate(av.id), asg.removeMaterial);

router.get('/exams', examCtrl.facultyList);
router.get('/exams/:id/marks', validate(ev.id), examCtrl.sheet);
router.put('/exams/:id/marks', validate(ev.marks), examCtrl.saveMarks);
router.post('/exams/:id/submit', validate(ev.id), examCtrl.submit);

// Today's classes (from the timetable) and the per-class lifecycle actions.
router.get('/today', validate(tv.today), tt.today);
router.post('/sessions/:id/open', validate(tv.sessionAction), tt.open);
router.post('/sessions/:id/cancel', validate(tv.cancelSession), tt.cancelSession);
router.post('/sessions/:id/resolve', validate(tv.resolveSession), tt.resolve);

// QR / code attendance: faculty open a window, the screen shows a rotating code, students submit it.
const qrCtrl = require('../controllers/qrController');
const qv = require('../validators/qr');
router.post('/sessions/:id/qr', validate(qv.start), qrCtrl.start);
router.get('/sessions/:id/qr', validate(qv.classParam), qrCtrl.current);
router.get('/sessions/:id/qr/scans', validate(qv.classParam), qrCtrl.scans);
router.post('/sessions/:id/qr/close', validate(qv.classParam), qrCtrl.close);

router.get('/subjects/:subjectId/students', validate(v.subjectParam), requireSubjectAccess('subjectId'), ctrl.students);

// Subject-wise attendance summary for a subject the teacher is assigned to.
router.get('/subjects/:subjectId/summary', validate(v.subjectParam), requireSubjectAccess('subjectId'), ctrl.summary);

router.get('/attendance/lookup', validate(v.lookup), (req, res, next) => {
  req.params.subjectId = req.validatedQuery.subjectId;
  next();
}, requireSubjectAccess('subjectId'), ctrl.lookup);

// Idempotent create-or-correct: the same (subject, date, slot) always maps to one session.
router.put('/attendance/sessions', validate(v.submit), ctrl.submit);
router.get('/attendance/sessions/:sessionId', validate(v.sessionParam), ctrl.detail);
router.put('/attendance/sessions/:sessionId', validate(v.update), ctrl.update);

module.exports = router;
