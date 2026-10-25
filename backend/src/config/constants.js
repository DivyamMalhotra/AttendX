const ROLES = Object.freeze({ HOD: 'hod', TEACHER: 'teacher', STUDENT: 'student', STAFF: 'staff', PARENT: 'parent' });

/** Display titles per base role; HOD is the college administrator, teacher is faculty. */
const ROLE_TITLES = Object.freeze({
  hod: 'Head of Department', teacher: 'Faculty', student: 'Student', staff: 'Staff', parent: 'Parent / Guardian'
});

/** Base roles that use the administrative console (what they see is filtered by permission). */
const CONSOLE_ROLES = Object.freeze(['hod', 'staff']);

const TIME_SLOTS = Object.freeze([
  '8:00 AM – 9:00 AM',
  '9:00 AM – 10:00 AM',
  '10:00 AM – 11:00 AM',
  '11:00 AM – 12:00 PM',
  '12:00 PM – 1:00 PM',
  '1:00 PM – 2:00 PM',
  '2:00 PM – 3:00 PM',
  '3:00 PM – 4:00 PM',
  '4:00 PM – 5:00 PM'
]);

const ATTENDANCE_STATUS = Object.freeze({ PRESENT: 'P', ABSENT: 'A' });
const ATTENDANCE_SOURCE = Object.freeze({ FACULTY: 'faculty', QR: 'qr', IMPORT: 'import' });

/** Lifecycle of one scheduled class (ClassSession). */
const SESSION_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  OPEN: 'open',
  SUBMITTED: 'submitted',
  CANCELLED: 'cancelled',
  COMPLETED_NO_ATTENDANCE: 'completed_no_attendance',
  UNMARKED: 'unmarked'
});

const DUTY_LEAVE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
});

const PAYMENT_STATUS = Object.freeze({
  CREATED: 'created',
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

const REFUND_STATUS = Object.freeze({
  REQUESTED: 'requested',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

const FEE_COMPONENT_KINDS = Object.freeze(['tuition', 'examination', 'registration', 'other']);
const FEE_CATEGORIES = Object.freeze(['semester', 'library_fine', 'hostel', 'other']);

const EXAM_STATUS = Object.freeze({
  DRAFT: 'draft',
  MARKS_ENTRY: 'marks_entry',
  SUBMITTED: 'submitted',
  REVIEWED: 'reviewed',
  LOCKED: 'locked',
  PUBLISHED: 'published'
});

const DUTY_LEAVE_POLICIES = Object.freeze({ EXCLUDE: 'exclude', COUNT_PRESENT: 'count_present' });

/** College level defaults; every value can be overridden per college by the administrator. */
const DEFAULT_SETTINGS = Object.freeze({
  attendanceThreshold: 75,
  dutyLeavePolicy: DUTY_LEAVE_POLICIES.EXCLUDE,
  allowResubmitAfterRejection: true,
  attendanceEditWindowDays: 30,
  allowPartialPayments: true,
  timezone: 'Asia/Kolkata'
});

const DUTY_LEAVE_LIMITS = Object.freeze({ maxRangeDays: 31, maxPastDays: 30, maxFutureDays: 90 });

const NOTIFICATION_TYPES = Object.freeze({
  ATTENDANCE_SHORTAGE: 'attendance_shortage',
  ATTENDANCE_RECOVERED: 'attendance_recovered',
  DUTY_LEAVE: 'duty_leave',
  PAYMENT: 'payment',
  FEE_REMINDER: 'fee_reminder',
  LATE_FEE: 'late_fee',
  REFUND: 'refund',
  ASSIGNMENT: 'assignment',
  EXAM: 'exam',
  RESULT: 'result',
  ANNOUNCEMENT: 'announcement',
  UNMARKED_CLASS: 'unmarked_class',
  LIBRARY: 'library',
  MENTOR: 'mentor',
  SYSTEM: 'system'
});

/**
 * Channel defaults per notification type. `mandatory` types ignore a user's opt-out of e-mail
 * (they are institutional notices); every type always creates the in-app record.
 * SMS is only on for important events and only when the college enables it.
 */
const NOTIFICATION_CATALOG = Object.freeze({
  attendance_shortage: { email: true, sms: true, mandatory: true },
  attendance_recovered: { email: false, sms: false, mandatory: false },
  duty_leave: { email: true, sms: false, mandatory: true },
  payment: { email: true, sms: true, mandatory: true },
  fee_reminder: { email: true, sms: true, mandatory: true },
  late_fee: { email: true, sms: false, mandatory: true },
  refund: { email: true, sms: false, mandatory: true },
  assignment: { email: true, sms: false, mandatory: false },
  exam: { email: true, sms: false, mandatory: false },
  result: { email: true, sms: false, mandatory: false },
  announcement: { email: true, sms: false, mandatory: false },
  unmarked_class: { email: true, sms: false, mandatory: false },
  library: { email: true, sms: false, mandatory: false },
  mentor: { email: false, sms: false, mandatory: false },
  system: { email: false, sms: false, mandatory: false }
});

module.exports = {
  ROLES, ROLE_TITLES, CONSOLE_ROLES, TIME_SLOTS, ATTENDANCE_STATUS, ATTENDANCE_SOURCE, SESSION_STATUS,
  DUTY_LEAVE_STATUS, PAYMENT_STATUS, REFUND_STATUS, FEE_COMPONENT_KINDS, FEE_CATEGORIES, EXAM_STATUS,
  DUTY_LEAVE_POLICIES, DEFAULT_SETTINGS, DUTY_LEAVE_LIMITS, NOTIFICATION_TYPES, NOTIFICATION_CATALOG
};
