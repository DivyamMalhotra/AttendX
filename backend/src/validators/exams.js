const { z, objectId, isoDate } = require('./common');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const id = { params: z.object({ id: objectId }) };

const base = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['internal', 'midterm', 'final', 'practical', 'other']).optional(),
  academicSessionId: objectId,
  semesterNumber: z.number().int().min(1).max(12).optional(),
  subjectId: objectId,
  date: isoDate,
  startTime: hhmm.optional(), endTime: hhmm.optional(),
  venue: z.string().trim().max(60).optional(),
  maxMarks: z.number().positive().max(1000),
  passMarks: z.number().min(0).max(1000),
  components: z.array(z.object({ name: z.string().trim().min(1).max(60), maxMarks: z.number().positive() })).max(10).optional(),
  countsForGpa: z.boolean().optional()
});

const create = { body: base };
const update = { ...id, body: base.partial().omit({ subjectId: true, academicSessionId: true }) };

const policy = {
  body: z.object({
    name: z.string().trim().min(2).max(80),
    absentGrade: z.string().trim().min(1).max(6).optional(),
    bands: z.array(z.object({
      minPercent: z.number().min(0).max(100), grade: z.string().trim().min(1).max(6),
      points: z.number().min(0).max(100), pass: z.boolean().optional()
    })).min(1).max(30)
  })
};

const marks = {
  ...id,
  body: z.object({
    reason: z.string().trim().max(200).optional(),
    entries: z.array(z.object({
      studentId: objectId, marks: z.number().nullable().optional(), absent: z.boolean().optional(), remark: z.string().trim().max(200).optional()
    })).min(1).max(500)
  })
};

const review = { ...id, body: z.object({ decision: z.enum(['approve', 'return']), reason: z.string().trim().max(300).optional() }) };
const reopen = { ...id, body: z.object({ reason: z.string().trim().min(5).max(300) }) };
const list = {
  query: z.object({ status: z.enum(['draft', 'marks_entry', 'submitted', 'reviewed', 'locked', 'published']).optional(), sessionId: objectId.optional(), semesterNumber: z.coerce.number().int().min(1).max(12).optional() })
};
const reportCard = { query: z.object({ sessionId: objectId, semesterNumber: z.coerce.number().int().min(1).max(12) }) };
const adminReportCard = { params: z.object({ studentId: objectId }), query: reportCard.query };
const verify = { query: z.object({ studentId: objectId, sessionId: objectId, semesterNumber: z.coerce.number().int().min(1).max(12), code: z.string().trim().min(6).max(20) }) };

module.exports = { id, create, update, policy, marks, review, reopen, list, reportCard, adminReportCard, verify };
