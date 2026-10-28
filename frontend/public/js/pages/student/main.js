import { startApp } from '../../services/app.js';
import { studentApi } from '../../api/endpoints.js';
import { noticeApi } from '../../api/phase2.js';

const nav = [
  { section: 'Home', items: [
    { key: 'dashboard', route: 'dashboard', label: 'Overview', icon: 'grid' },
    { key: 'announcements', route: 'announcements', label: 'Announcements', icon: 'bell' },
    { key: 'notifications', route: 'notifications', label: 'Notifications', icon: 'bell' },
    { key: 'timeline', route: 'timeline', label: 'My timeline', icon: 'list' },
    { key: 'profile', route: 'profile', label: 'Profile', icon: 'user' }
  ] },
  { section: 'Attendance', items: [
    { key: 'attendance', route: 'attendance', label: 'My attendance', icon: 'chart' },
    { key: 'qr', route: 'qr', label: 'Mark attendance', icon: 'check' },
    { key: 'timetable', route: 'timetable', label: 'Timetable', icon: 'clock' },
    { key: 'duty-leave', route: 'duty-leave', label: 'Leave', icon: 'calendar' }
  ] },
  { section: 'Academics', items: [
    { key: 'assignments', route: 'assignments', label: 'Assignments', icon: 'list' },
    { key: 'materials', route: 'materials', label: 'Study material', icon: 'classes' },
    { key: 'results', route: 'results', label: 'Results', icon: 'chart' }
  ] },
  { section: 'Finance', items: [
    { key: 'fees', route: 'fees', label: 'Fees & payments', icon: 'card' },
    { key: 'payments', route: 'payments', label: 'History & receipts', icon: 'receipt' }
  ] },
  { section: 'Campus', items: [
    { key: 'campus', route: 'campus', label: 'Library', icon: 'classes' }
  ] }
];

const page = file => () => import(`./${file}`);
const routes = [
  { pattern: 'dashboard', nav: 'dashboard', load: page('dashboard.js') },
  { pattern: 'attendance', nav: 'attendance', load: page('attendance.js') },
  { pattern: 'qr', nav: 'qr', load: page('qr.js') },
  { pattern: 'timetable', nav: 'timetable', load: page('timetable.js') },
  { pattern: 'duty-leave', nav: 'duty-leave', load: page('dutyLeave.js') },
  { pattern: 'assignments', nav: 'assignments', load: page('assignments.js') },
  { pattern: 'materials', nav: 'materials', load: page('materials.js') },
  { pattern: 'results', nav: 'results', load: page('results.js') },
  { pattern: 'fees', nav: 'fees', load: page('fees.js') },
  { pattern: 'payments', nav: 'payments', load: page('history.js') },
  { pattern: 'campus', nav: 'campus', load: page('campus.js') },
  { pattern: 'announcements', nav: 'announcements', load: () => import('../shared/announcements.js') },
  { pattern: 'notifications', nav: 'notifications', load: page('notifications.js') },
  { pattern: 'timeline', nav: 'timeline', load: page('timeline.js') },
  { pattern: 'profile', nav: 'profile', load: page('profile.js') }
];

const ctx = await startApp({ role: 'student', nav, routes, defaultRoute: 'dashboard' });

// Sidebar counts stay current: once on load and again whenever the server pushes a "notification" event.
if (ctx) {
  const refreshBadges = () => {
    studentApi.notifications({ limit: 1 }).then(({ meta }) => ctx.shell.setBadge('notifications', meta.unread || 0)).catch(() => {});
    noticeApi.feed({ unread: true }).then(rows => ctx.shell.setBadge('announcements', rows.length)).catch(() => {});
  };
  refreshBadges();
  ctx.live.always('notification', refreshBadges);
}
