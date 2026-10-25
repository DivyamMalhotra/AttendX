const express = require('express');
const ctrl = require('../controllers/mentoringController');
const validate = require('../middleware/validate');
const { requirePermission: need } = require('../middleware/permissions');
const v = require('../validators/mentoring');

/** Mentor workspace, mounted at /api/mentor (faculty/staff). Assignment-based access is enforced in mentorService. */
const mentor = express.Router();
mentor.get('/students', ctrl.mentees);
mentor.get('/followups', ctrl.followUps);
mentor.get('/students/:studentId/overview', validate(v.studentParam), ctrl.overview);
mentor.get('/students/:studentId/timeline', validate(v.timelineStudent), ctrl.timeline);
mentor.get('/students/:studentId/notes', validate(v.studentParam), ctrl.notes);
mentor.post('/students/:studentId/notes', validate(v.noteCreate), ctrl.addNote);
mentor.patch('/notes/:id', validate(v.noteUpdate), ctrl.updateNote);

/** Administration, mounted at /api/admin/mentoring behind a console role. */
const admin = express.Router();
admin.post('/assign', need('mentors.manage'), validate(v.assign), ctrl.assign);
admin.get('/assignments', need('mentors.manage'), ctrl.assignments);
admin.get('/history/:studentId', need('mentors.manage'), validate(v.studentParam), ctrl.history);
admin.post('/parents', need('parents.manage'), validate(v.parentCreate), ctrl.parentCreate);
admin.post('/parents/links', need('parents.manage'), validate(v.linkCreate), ctrl.parentLink);
admin.post('/parents/links/:id/revoke', need('parents.manage'), validate(v.revoke), ctrl.parentRevoke);
admin.get('/parents', need('parents.manage'), validate(v.linkList), ctrl.parentList);
// Any student's timeline for institutional roles holding timeline.view (department scope enforced in mentorService)
admin.get('/students/:studentId/timeline', need('timeline.view'), validate(v.timelineStudent), ctrl.timeline);

/** Read-only parent portal, mounted at /api/parent. */
const parent = express.Router();
parent.get('/children', ctrl.children);
parent.get('/children/:studentId/timeline', validate(v.timelineStudent), ctrl.parentTimeline);
parent.get('/children/:studentId/:area', validate(v.childParam), ctrl.childView);

module.exports = { mentor, admin, parent };
