import { startApp } from '../../services/app.js';

/**
 * Two pages share this code. admin.html (data-console="admin") is the Administrator's console only; hod.html serves the
 * HOD, Accounts Clerk and Exam Cell and never contains an Administrator page. Every entry lists
 * the roles it is for and the permissions that make it useful; the sidebar and routes only include entries that match
 * both (the server enforces the same rules on every request).
 */
const A = 'admin', H = 'hod', C = 'accounts_clerk', E = 'exam_cell';
const ADMIN_PAGE = document.body.dataset.console === 'admin';
const ALL_ENTRIES = [
  ['Management', 'overview', 'Overview', 'grid', 'overview.js', ['dashboard.view'], [A]],
  ['Management', 'sections', 'Sections', 'classes', 'sections.js', ['roster.manage'], [A]],
  ['Management', 'teachers', 'Teachers', 'user', 'teachers.js', ['roster.manage'], [A]],
  ['Management', 'students', 'Students', 'users', 'students.js', ['students.manage', 'students.view'], [A, H]],
  ['Management', 'access', 'Staff accounts', 'user', 'access.js', ['roles.manage'], [A]],
  ['Management', 'mentoring', 'Mentors & parents', 'users', 'mentoring.js', ['mentors.manage', 'parents.manage'], [A]],
  ['Management', 'timetable', 'Timetables', 'clock', 'timetable.js', ['timetable.manage', 'timetable.view'], [A]],
  ['Management', 'exams', 'Examinations', 'list', 'exams.js', ['exams.configure', 'marks.review', 'results.publish', 'results.view'], [A, E, H]],
  ['Management', 'leave-types', 'Leave types', 'calendar', 'leaveTypes.js', ['leave.configure'], [A]],
  ['Management', 'duty-leave', 'Unassigned leave', 'calendar', 'dutyLeave.js', ['leave.review'], [A]],
  ['Management', 'announcements', 'Announcements', 'bell', 'announcements.js', ['announcements.publish', 'announcements.view'], [A]],
  ['Attendance', 'attendance', 'Reports', 'chart', 'attendance.js', ['attendance.view'], [A, H]],
  ['Attendance', 'analytics', 'Analytics', 'chart', 'analytics.js', ['analytics.view'], [A, H]],
  ['Attendance', 'at-risk', 'At-risk students', 'alert', 'atRisk.js', ['analytics.atRisk'], [H]],
  ['Fees', 'fees/overview', 'Overview', 'card', '../administration/feeOverview.js', ['fees.view', 'payments.view'], [C]],
  ['Fees', 'fees/structures', 'Structures', 'list', '../administration/feeStructures.js', ['fees.configure', 'fees.view'], [C]],
  ['Fees', 'fees/assign', 'Assign', 'users', '../administration/feeAssignments.js', ['fees.assign', 'fees.view'], [C]],
  ['Fees', 'fees/transactions', 'Transactions', 'receipt', '../administration/transactions.js', ['payments.view'], [C]],
  ['Fees', 'fees/reports', 'Reports', 'chart', '../administration/feeReports.js', ['fees.view'], [C]],
  ['Fees', 'fees/refunds', 'Refunds & late fees', 'receipt', '../administration/finance.js', ['refunds.request', 'refunds.approve', 'latefees.waive', 'fees.configure'], [C]],
  ['Campus', 'library', 'Library', 'classes', 'library.js', ['library.manage'], [A]],
  ['Data', 'data', 'Import & export', 'download', 'data.js', ['imports.manage', 'reports.export'], [A, E, H]],
  ['Admin', 'settings', 'Settings', 'gear', 'settings.js', ['settings.manage'], [A]],
  ['Admin', 'system', 'Jobs & backups', 'gear', 'system.js', ['system.health', 'system.jobs', 'system.backup'], [A]],
  ['Admin', 'audit', 'Audit Logs', 'list', 'auditLog.js', ['audit.view'], [A]]
];

// the Administrator page keeps only Administrator entries; the staff page drops them (and any entry left without a role)
const ENTRIES = ALL_ENTRIES
  .map(e => [...e.slice(0, 6), ADMIN_PAGE ? e[6].filter(r => r === A) : e[6].filter(r => r !== A)])
  .filter(e => e[6].length);

const can = (user, perms) => perms.some(p => (user.permissions || []).includes(p));

// This only decides what the interface offers; the server checks the role and permission again on every request.
const allowed = (user, perms, roles) => roles.includes(user.role) && can(user, perms);

// every entry belongs to a workspace (a tab in the header); entries keep their order inside it.
// The Administrator console has its own workspaces: college settings and system first, then the running of the college.
const WORKSPACE = ADMIN_PAGE
  ? { settings: 'Settings', system: 'System', audit: 'System',
      sections: 'College', teachers: 'College', students: 'College', access: 'College', mentoring: 'College', timetable: 'College',
      'leave-types': 'College', 'duty-leave': 'College', announcements: 'College', library: 'College',
      overview: 'Reports', attendance: 'Reports', analytics: 'Reports', exams: 'Reports', data: 'Reports' }
  : { overview: 'Overview', students: 'People', attendance: 'Attendance', analytics: 'Attendance', 'at-risk': 'Attendance', exams: 'Academics',
      'fees/overview': 'Fees', 'fees/structures': 'Fees', 'fees/assign': 'Fees', 'fees/transactions': 'Fees', 'fees/reports': 'Fees', 'fees/refunds': 'Fees', data: 'Data' };
const ORDER = ADMIN_PAGE ? ['Settings', 'System', 'College', 'Reports'] : ['Overview', 'People', 'Attendance', 'Academics', 'Fees', 'Campus', 'Data'];
const ORDERED = [...ENTRIES].map(e => [WORKSPACE[e[1]] || e[0], ...e.slice(1)]).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));

const nav = user => {
  const groups = [];
  for (const [section, key, label, icon, , perms, roles] of ORDERED) {
    if (!allowed(user, perms, roles)) continue;
    let g = groups.find(x => x.section === section);
    if (!g) { g = { section, items: [] }; groups.push(g); }
    g.items.push({ key, route: key, label, icon });
  }
  return groups;
};

const page = file => () => import(`./${file}`);
const routes = ENTRIES.map(([, key, , , file, perms, roles]) => ({ pattern: key, nav: key, load: page(file), perms, allow: user => roles.includes(user.role) }));

// Old bookmarks and links keep working: each former fee route forwards to its new home.
const LEGACY = { 'fee-structures': 'fees/structures', 'fee-assignments': 'fees/assign', transactions: 'fees/transactions', finance: 'fees/refunds' };
Object.entries(LEGACY).forEach(([from, to]) => routes.push({ pattern: from, redirect: to }));
routes.push({ pattern: 'timetable/:id', nav: 'timetable', load: page('timetable.js'), perms: ['timetable.manage', 'timetable.view'], allow: user => user.role === A });

await startApp({ roles: ADMIN_PAGE ? [A] : [H, C, E], nav, routes, defaultRoute: user => ADMIN_PAGE ? 'settings' : (nav(user)[0]?.items[0]?.route || 'overview') });
