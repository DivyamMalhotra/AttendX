const { z, objectId, isoDate, trimmed, email, password, pagination } = require('./common');
const { DUTY_LEAVE_POLICIES, NOTIFICATION_CATALOG } = require('../config/constants');

const optionalText = max => z.string().trim().max(max).optional();
const id = { params: z.object({ id: objectId }) };

/* ----- sections / subjects / teachers ----- */
const sectionBody = z.object({
  name: trimmed(40),
  semesterNumber: z.number().int().min(1).max(12),
  sem: optionalText(20),
  course: optionalText(80),
  specialization: optionalText(80)
});
const sectionCreate = { body: sectionBody };
const sectionUpdate = { ...id, body: sectionBody.partial() };
const mentor = { ...id, body: z.object({ mentorId: objectId.nullable() }) };

const subjectCreate = {
  params: z.object({ id: objectId }),
  body: z.object({ name: trimmed(100), code: optionalText(20), credits: z.number().min(0).max(40).optional(), teacherId: objectId.nullable().optional() })
};
const subjectUpdate = {
  ...id,
  body: z.object({ name: trimmed(100).optional(), code: optionalText(20), credits: z.number().min(0).max(40).optional(), teacherId: objectId.nullable().optional() })
};

const teacherCreate = { body: z.object({ name: trimmed(120), email, password }) };
const teacherUpdate = {
  ...id,
  body: z.object({ name: trimmed(120).optional(), active: z.boolean().optional(), password: password.optional() })
};

/* ----- students ----- */
const studentCreate = {
  body: z.object({
    name: trimmed(120), email, password,
    rollNo: z.string().trim().min(1).max(40),
    sectionId: objectId,
    phone: optionalText(20),
    admissionYear: z.number().int().min(1990).max(2100).optional()
  })
};
const studentUpdate = {
  ...id,
  body: z.object({
    name: trimmed(120).optional(), rollNo: z.string().trim().min(1).max(40).optional(), sectionId: objectId.optional(),
    phone: optionalText(20), admissionYear: z.number().int().min(1990).max(2100).optional(),
    active: z.boolean().optional(), password: password.optional()
  })
};
const studentList = {
  query: z.object({
    q: z.string().trim().max(60).optional(), sectionId: objectId.optional(),
    includeInactive: z.enum(['true', 'false']).optional(), ...pagination
  })
};

/* ----- settings / academic sessions ----- */
const settingsUpdate = {
  body: z.object({
    attendanceThreshold: z.number().int().min(1).max(100).optional(),
    dutyLeavePolicy: z.enum(Object.values(DUTY_LEAVE_POLICIES)).optional(),
    allowResubmitAfterRejection: z.boolean().optional(),
    attendanceEditWindowDays: z.number().int().min(0).max(365).optional(),
    allowPartialPayments: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    notifications: z.partialRecord(z.enum(Object.keys(NOTIFICATION_CATALOG)), z.object({ email: z.boolean().optional(), sms: z.boolean().optional() }).strict()).optional(),
    feeReminders: z.object({
      enabled: z.boolean().optional(), offsetsDays: z.array(z.number().int().min(-60).max(180)).max(8).optional(), repeatEveryDays: z.number().int().min(0).max(90).optional()
    }).strict().optional(),
    unmarked: z.object({ graceMinutes: z.number().int().min(0).max(1440).optional(), notifyAdmins: z.boolean().optional() }).strict().optional(),
    atRisk: z.object({
      attendanceBelow: z.number().int().min(1).max(100).optional(), flagOverdueFees: z.boolean().optional(), flagFailingResults: z.boolean().optional(),
      flagMissingAssignments: z.boolean().optional(), minFlags: z.number().int().min(1).max(4).optional()
    }).strict().optional(),
    library: z.object({
      loanDays: z.number().int().min(1).max(365).optional(), finePerDayPaise: z.number().int().min(0).max(1_000_000).optional(), maxFinePaise: z.number().int().min(0).max(100_000_000).optional(),
      maxActiveIssues: z.number().int().min(1).max(50).optional(), chargeFinesToFees: z.boolean().optional()
    }).strict().optional(),
    qr: z.object({
      enabled: z.boolean().optional(), rotateSeconds: z.number().int().min(10).max(300).optional(), sessionMinutes: z.number().int().min(1).max(180).optional(),
      geofence: z.object({
        enabled: z.boolean().optional(), lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), radiusMeters: z.number().int().min(20).max(5000).optional()
      }).strict().optional()
    }).strict().optional(),
    parentVisibility: z.object({
      attendance: z.boolean().optional(), leave: z.boolean().optional(), results: z.boolean().optional(), fees: z.boolean().optional(), payments: z.boolean().optional(), announcements: z.boolean().optional()
    }).strict().optional()
  }).strict().refine(o => Object.keys(o).length > 0, 'No settings supplied')
};
const sessionCreate = {
  body: z.object({ name: trimmed(30), startDate: isoDate, endDate: isoDate, isCurrent: z.boolean().optional() })
};

const pageQuery = { query: z.object({ ...pagination }) };
const auditQuery = {
  query: z.object({ action: z.string().trim().max(60).optional(), entityType: z.string().trim().max(40).optional(), ...pagination })
};
const attendanceReportQuery = {
  query: z.object({
    sectionId: objectId.optional(), subjectId: objectId.optional(),
    belowThreshold: z.enum(['true', 'false']).optional(), format: z.enum(['json', 'csv']).optional(), ...pagination
  })
};

module.exports = {
  id, sectionCreate, sectionUpdate, mentor, subjectCreate, subjectUpdate, teacherCreate, teacherUpdate,
  studentCreate, studentUpdate, studentList, settingsUpdate, sessionCreate, pageQuery, auditQuery, attendanceReportQuery
};
