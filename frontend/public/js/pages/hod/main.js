import { startApp } from '../../services/app.js';

/**
 * The administrator console serves the college administrator ("hod") and staff holding custom roles.
 * Each entry lists the permissions that make it useful; the sidebar and routes only include entries the signed-in
 * person holds at least one of (the server enforces the same rules on every request).
 */
const ENTRIES = [
  ['Management', 'overview', 'Overview', 'grid', 'overview.js', ['dashboard.view']],
  ['Management', 'sections', 'Sections', 'classes', 'sections.js', ['roster.manage']],
  ['Management', 'teachers', 'Teachers', 'user', 'teachers.js', ['roster.manage']],
  ['Management', 'students', 'Students', 'users', 'students.js', ['students.manage', 'students.view']],
  ['Management', 'access', 'Roles & staff', 'user', 'access.js', ['roles.manage']],
  ['Management', 'mentoring', 'Mentors & parents', 'users', 'mentoring.js', ['mentors.manage', 'parents.manage']],
  ['Management', 'timetable', 'Timetables', 'clock', 'timetable.js', ['timetable.manage', 'timetable.view']],
  ['Management', 'exams', 'Examinations', 'list', 'exams.js', ['exams.configure', 'marks.review', 'results.publish', 'results.view']],
  ['Management', 'leave-types', 'Leave types', 'calendar', 'leaveTypes.js', ['leave.configure']],
  ['Management', 'duty-leave', 'Leave requests', 'calendar', 'dutyLeave.js', ['leave.review']],
  ['Management', 'announcements', 'Announcements', 'bell', 'announcements.js', ['announcements.publish', 'announcements.view']],
  ['Attendance', 'attendance', 'Reports & Alerts', 'chart', 'attendance.js', ['attendance.view']],
  ['Attendance', 'analytics', 'Analytics', 'chart', 'analytics.js', ['analytics.view']],
  ['Attendance', 'at-risk', 'At-risk students', 'alert', 'atRisk.js', ['analytics.atRisk']],
  ['Fees', 'fee-structures', 'Fee Structures', 'card', 'feeStructures.js', ['fees.configure', 'fees.view']],
  ['Fees', 'fee-assignments', 'Fee Assignments', 'list', 'feeAssignments.js', ['fees.assign', 'fees.view']],
  ['Fees', 'transactions', 'Transactions', 'receipt', 'transactions.js', ['payments.view']],
  ['Fees', 'finance', 'Refunds & late fees', 'receipt', 'finance.js', ['refunds.request', 'refunds.approve', 'latefees.waive', 'fees.configure']],
  ['Campus', 'library', 'Library', 'classes', 'library.js', ['library.manage']],
  ['Campus', 'hostel', 'Hostel', 'classes', 'hostel.js', ['hostel.manage']],
  ['Data', 'data', 'Import & export', 'download', 'data.js', ['imports.manage', 'reports.export']],
  ['System', 'settings', 'Settings', 'gear', 'settings.js', ['settings.manage', 'dashboard.view']],
  ['System', 'system', 'Jobs & backups', 'gear', 'system.js', ['system.health', 'system.jobs', 'system.backup']],
  ['System', 'audit', 'Audit Log', 'list', 'auditLog.js', ['audit.view']]
];

const can = (user, perms) => perms.some(p => (user.permissions || []).includes(p));

// every entry belongs to a workspace (a tab in the header); entries keep their order inside it
const WORKSPACE = { overview: 'Overview', sections: 'People', teachers: 'People', students: 'People', access: 'People', mentoring: 'People',
  attendance: 'Attendance', analytics: 'Attendance', 'at-risk': 'Attendance', 'duty-leave': 'Attendance', timetable: 'Attendance',
  exams: 'Academics', 'leave-types': 'Academics', announcements: 'Academics',
  'fee-structures': 'Finance', 'fee-assignments': 'Finance', transactions: 'Finance', finance: 'Finance', library: 'Campus', hostel: 'Campus',
  data: 'System', settings: 'System', system: 'System', audit: 'System' };
const ORDER = ['Overview', 'People', 'Attendance', 'Academics', 'Finance', 'Campus', 'System'];
const ORDERED = [...ENTRIES].map(e => [WORKSPACE[e[1]] || e[0], ...e.slice(1)]).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));

const nav = user => {
  const groups = [];
  for (const [section, key, label, icon, , perms] of ORDERED) {
    if (!can(user, perms)) continue;
    let g = groups.find(x => x.section === section);
    if (!g) { g = { section, items: [] }; groups.push(g); }
    g.items.push({ key, route: key, label, icon });
  }
  return groups;
};

const page = file => () => import(`./${file}`);
const routes = ENTRIES.map(([, key, , , file, perms]) => ({ pattern: key, nav: key, load: page(file), perms }));
routes.push({ pattern: 'timetable/:id', nav: 'timetable', load: page('timetable.js'), perms: ['timetable.manage', 'timetable.view'] });

await startApp({ roles: ['hod', 'staff'], nav, routes, defaultRoute: user => nav(user)[0]?.items[0]?.route || 'overview' });
