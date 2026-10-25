/**
 * Permission catalogue. Keys are "<area>.<action>". Base roles carry a fixed permission set;
 * administrators can create additional roles from these permissions (see roleService).
 * "*" means every permission and is reserved for the college administrator (HOD).
 */
const PERMISSIONS = [
  ['dashboard.view', 'View the administrative dashboard', 'General'],
  ['roster.manage', 'Manage sections, subjects, teachers and departments', 'Academic structure'],
  ['students.manage', 'Register and edit students', 'Students'],
  ['students.view', 'View student records', 'Students'],
  ['settings.manage', 'Change college settings and academic sessions', 'System'],
  ['audit.view', 'View the audit log', 'System'],
  ['system.health', 'View readiness, job and backup status', 'System'],
  ['system.jobs', 'Run background jobs manually', 'System'],
  ['system.backup', 'Create and inspect backups', 'System'],
  ['roles.manage', 'Create roles and assign permissions', 'Access control'],
  ['timetable.manage', 'Create and approve timetables', 'Scheduling'],
  ['timetable.view', 'View timetables', 'Scheduling'],
  ['attendance.view', 'View institution-wide attendance reports, alerts and unmarked classes', 'Attendance'],
  ['attendance.mark', 'Mark attendance for assigned classes', 'Attendance'],
  ['attendance.correct', 'Correct attendance within the allowed window', 'Attendance'],
  ['attendance.approveCorrection', 'Resolve unmarked classes and approve corrections', 'Attendance'],
  ['leave.review', 'Review leave and duty leave requests', 'Leave'],
  ['leave.reviewMedical', 'Review medical leave and see medical documents', 'Leave'],
  ['leave.configure', 'Configure leave types', 'Leave'],
  ['exams.configure', 'Schedule examinations and grading policies', 'Examinations'],
  ['marks.enter', 'Enter marks for assigned examinations', 'Examinations'],
  ['marks.review', 'Review submitted marks', 'Examinations'],
  ['results.publish', 'Lock and publish results', 'Examinations'],
  ['results.reopen', 'Reopen locked or published results', 'Examinations'],
  ['results.view', 'View results and report cards of any student', 'Examinations'],
  ['fees.view', 'View fee assignments and balances', 'Fees'],
  ['fees.configure', 'Create fee structures, reminder and late-fee policies', 'Fees'],
  ['fees.assign', 'Assign fees and apply concessions', 'Fees'],
  ['payments.view', 'View payment transactions and receipts', 'Fees'],
  ['payments.reconcile', 'Reconcile payments with the gateway', 'Fees'],
  ['refunds.request', 'Request refunds on behalf of students', 'Fees'],
  ['refunds.approve', 'Approve and process refunds', 'Fees'],
  ['latefees.waive', 'Waive assessed late fees', 'Fees'],
  ['announcements.publish', 'Publish announcements and circulars', 'Communication'],
  ['announcements.view', 'View announcement engagement', 'Communication'],
  ['assignments.manage', 'Create assignments and study material for assigned subjects', 'Academics'],
  ['mentors.manage', 'Assign mentors to students', 'Mentoring'],
  ['mentorNotes.view', 'Read counselling notes of any student', 'Mentoring'],
  ['parents.manage', 'Create and link parent accounts', 'Mentoring'],
  ['library.manage', 'Manage the library catalogue and loans', 'Library'],
  ['hostel.manage', 'Manage hostels, rooms and allocations', 'Hostel'],
  ['analytics.view', 'View analytics dashboards', 'Analytics'],
  ['analytics.atRisk', 'View the at-risk student list', 'Analytics'],
  ['reports.export', 'Export reports and data as CSV', 'Analytics'],
  ['imports.manage', 'Run bulk imports', 'Data'],
  ['timeline.view', 'View a student activity timeline', 'Students']
].map(([key, label, group]) => ({ key, label, group }));

const PERMISSION_KEYS = new Set(PERMISSIONS.map(p => p.key));

/**
 * Permissions the wildcard "*" does NOT include. Counselling notes are confidential: even the college
 * administrator must be given this permission explicitly (through a role such as Counsellor).
 */
const NOT_IMPLICIT = new Set(['mentorNotes.view']);

const BASE_ROLE_PERMISSIONS = Object.freeze({
  hod: ['*'],
  teacher: ['attendance.mark', 'attendance.correct', 'timetable.view', 'marks.enter', 'assignments.manage', 'leave.review'],
  student: [],
  parent: [],
  staff: []
});

/** Role templates an administrator can instantiate for their college (stored as built-in Role documents). */
const ROLE_TEMPLATES = [
  { key: 'principal', name: 'Principal', scope: 'college', description: 'Institution-wide aggregate view',
    permissions: ['dashboard.view', 'analytics.view', 'analytics.atRisk', 'attendance.view', 'fees.view', 'payments.view', 'results.view', 'timetable.view', 'announcements.publish', 'announcements.view', 'reports.export', 'students.view', 'timeline.view'] },
  { key: 'dept_head', name: 'Department Head', scope: 'department', description: 'Own departments only',
    permissions: ['dashboard.view', 'analytics.view', 'analytics.atRisk', 'attendance.view', 'attendance.approveCorrection', 'timetable.view', 'timetable.manage', 'results.view', 'marks.review', 'fees.view', 'students.view', 'reports.export', 'timeline.view', 'leave.review'] },
  { key: 'accounts_clerk', name: 'Accounts Clerk', scope: 'college', description: 'Fees and payments',
    permissions: ['dashboard.view', 'fees.view', 'fees.configure', 'fees.assign', 'payments.view', 'payments.reconcile', 'refunds.request', 'reports.export', 'students.view'] },
  { key: 'accounts_head', name: 'Accounts Head', scope: 'college', description: 'Approves refunds and waivers',
    permissions: ['dashboard.view', 'fees.view', 'payments.view', 'refunds.request', 'refunds.approve', 'latefees.waive', 'reports.export'] },
  { key: 'exam_cell', name: 'Examination Cell', scope: 'college', description: 'Exams, results and report cards',
    permissions: ['dashboard.view', 'exams.configure', 'marks.review', 'results.publish', 'results.reopen', 'results.view', 'imports.manage', 'reports.export', 'students.view'] },
  { key: 'librarian', name: 'Librarian', scope: 'college', description: 'Library catalogue and loans',
    permissions: ['dashboard.view', 'library.manage', 'students.view', 'reports.export'] },
  { key: 'hostel_warden', name: 'Hostel Warden', scope: 'college', description: 'Hostel rooms and allocations',
    permissions: ['dashboard.view', 'hostel.manage', 'students.view'] },
  { key: 'mentor', name: 'Mentor', scope: 'college', description: 'Mentoring of assigned students (assignment-based access)',
    permissions: ['timeline.view'] },
  { key: 'counsellor', name: 'Counsellor', scope: 'college', description: 'May read counselling notes',
    permissions: ['mentorNotes.view', 'students.view', 'timeline.view'] },
  { key: 'registrar', name: 'Registrar', scope: 'college', description: 'Student records, imports and parents',
    permissions: ['dashboard.view', 'students.manage', 'students.view', 'imports.manage', 'parents.manage', 'mentors.manage', 'announcements.publish', 'reports.export', 'leave.review'] }
];

module.exports = { PERMISSIONS, PERMISSION_KEYS, NOT_IMPLICIT, BASE_ROLE_PERMISSIONS, ROLE_TEMPLATES };
