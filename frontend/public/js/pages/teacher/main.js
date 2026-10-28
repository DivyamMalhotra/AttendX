import { startApp } from '../../services/app.js';

const nav = [
  { section: 'Home', items: [
    { key: 'today', route: 'today', label: 'Today', icon: 'clock' },
    { key: 'announcements', route: 'announcements', label: 'Announcements', icon: 'bell' }
  ] },
  { section: 'Attendance', items: [
    { key: 'classes', route: 'classes', label: 'My classes', icon: 'classes' },
    { key: 'attendance-watch', route: 'attendance-watch', label: 'Attendance watch', icon: 'alert' },
    { key: 'duty-leave', route: 'duty-leave', label: 'Leave requests', icon: 'calendar' }
  ] },
  { section: 'Academics', items: [
    { key: 'exams', route: 'exams', label: 'Examinations', icon: 'list' }
  ] }
];

const page = file => () => import(`./${file}`);
const routes = [
  { pattern: 'today', nav: 'today', load: page('today.js') },
  { pattern: 'classes', nav: 'classes', load: page('classes.js') },
  { pattern: 'session/new/:subjectId', nav: 'classes', load: page('session.js') },
  { pattern: 'session/edit/:sessionId', nav: 'classes', load: page('session.js') },
  { pattern: 'summary/:subjectId', nav: 'classes', load: page('summary.js') },
  { pattern: 'exams', nav: 'exams', load: page('exams.js') },
  { pattern: 'exam/:id', nav: 'exams', load: page('exams.js') },
  { pattern: 'attendance-watch', nav: 'attendance-watch', load: page('attendanceWatch.js') },
  { pattern: 'duty-leave', nav: 'duty-leave', load: page('dutyLeave.js') },
  { pattern: 'announcements', nav: 'announcements', load: () => import('../shared/announcements.js') }
];

await startApp({ role: 'teacher', nav, routes, defaultRoute: 'today' });
