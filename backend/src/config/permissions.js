/**
 * Permission catalogue. Keys are "<area>.<action>". Base roles carry a fixed permission set;
 * administrators can create additional roles from these permissions (see roleService).
 * "*" means every permission and is reserved for the Administrator.
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
  ['marks.upload', 'Upload marks for any examination from a CSV file', 'Examinations'],
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
  ['parents.manage', 'Create parent accounts and link them to verified students', 'Mentoring'],
  ['mentorNotes.view', 'Read counselling notes of any student', 'Mentoring'],
  ['library.manage', 'Manage the library catalogue and loans', 'Library'],
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
const NOT_IMPLICIT = new Set(['mentorNotes.view', 'leave.reviewMedical', 'analytics.atRisk']);

const BASE_ROLE_PERMISSIONS = Object.freeze({
  // The Administrator configures and runs the college ERP. It does not hold the HOD's academic-oversight permission.
  admin: ['*'],
  // The HOD oversees the academics of the departments assigned to that HOD. Every permission here is DEPARTMENT-scoped
  // (see DEPARTMENT_ROLES): it applies only inside user.departments and never reaches settings, jobs, backups or audit logs.
  hod: ['attendance.view', 'analytics.view', 'analytics.atRisk', 'students.view', 'results.view', 'reports.export', 'timeline.view'],
  teacher: ['attendance.mark', 'attendance.correct', 'timetable.view', 'marks.enter', 'assignments.manage', 'leave.review'],
  student: [],
  // Fixed permission sets of the support roles. Neither touches attendance.
  accounts_clerk: ['dashboard.view', 'fees.view', 'fees.configure', 'fees.assign', 'payments.view', 'payments.reconcile', 'refunds.request', 'refunds.approve', 'latefees.waive', 'reports.export', 'students.view'],
  exam_cell: ['dashboard.view', 'exams.configure', 'marks.review', 'marks.upload', 'results.publish', 'results.reopen', 'results.view', 'imports.manage', 'reports.export', 'students.view'],
  // The Parent portal has its own routes that check the verified parent-student link; no console permission.
  parent: []
});

/** Base roles whose permissions only apply inside the departments assigned to the user. */
const DEPARTMENT_ROLES = Object.freeze(['hod']);

/** Role templates an administrator can instantiate for their college (stored as built-in Role documents). */
const ROLE_TEMPLATES = []; // the seven roles are fixed; no further role presets exist

module.exports = { DEPARTMENT_ROLES, PERMISSIONS, PERMISSION_KEYS, NOT_IMPLICIT, BASE_ROLE_PERMISSIONS, ROLE_TEMPLATES };
