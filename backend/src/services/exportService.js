const { StudentProfile, FeeAssignment, Payment, User } = require('../models');
const { MarksEntry } = require('../models/Exam');
const { allowedSectionIds } = require('./permissionService');
const { toCsv } = require('../utils/csv');
const { outstandingPaise } = require('../utils/feeMath');
const { forbidden, badRequest } = require('../utils/errors');
const audit = require('./auditService');

/**
 * CSV exports. Every cell goes through the shared CSV writer, which neutralises spreadsheet formulas (a value such
 * as =HYPERLINK(...) is exported as plain text), and every export is audit-logged with who ran it and how many rows.
 * Amounts are exported in rupees with two decimals; student scope follows the viewer's department permissions.
 */
const rupees = paise => (paise / 100).toFixed(2);
const MAX = 20000;

const DEFINITIONS = {
  students: {
    permission: 'students.view',
    label: 'Students',
    async rows({ college, req }) {
      const allowed = await allowedSectionIds(req, 'students.view');
      const profiles = await StudentProfile.find({ college: college._id, ...(allowed ? { section: { $in: allowed } } : {}) })
        .populate('user', 'name email').populate('section', 'name sem course').sort({ rollNo: 1 }).limit(MAX).lean();
      return { columns: [
        { label: 'Roll no', value: 'rollNo' }, { label: 'Name', value: r => r.user && r.user.name }, { label: 'Email', value: r => r.user && r.user.email },
        { label: 'Section', value: r => r.section && r.section.name }, { label: 'Semester', value: r => r.section && r.section.sem }, { label: 'Active', value: r => (r.active ? 'yes' : 'no') }
      ], rows: profiles };
    }
  },
  fees: {
    permission: 'fees.view',
    async rows({ college, req }) {
      const allowed = await allowedSectionIds(req, 'fees.view');
      let studentFilter = {};
      if (allowed) studentFilter = { student: { $in: (await StudentProfile.find({ college: college._id, section: { $in: allowed } }).select('_id').lean()).map(s => s._id) } };
      const fees = await FeeAssignment.find({ college: college._id, ...studentFilter }).populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } })
        .populate('academicSession', 'name').sort({ createdAt: -1 }).limit(MAX).lean();
      return { columns: [
        { label: 'Roll no', value: r => r.student && r.student.rollNo }, { label: 'Name', value: r => r.student && r.student.user && r.student.user.name },
        { label: 'Session', value: r => r.academicSession && r.academicSession.name }, { label: 'Category', value: 'category' }, { label: 'Semester', value: 'semesterNumber' },
        { label: 'Description', value: 'description' }, { label: 'Payable (INR)', value: r => rupees(r.totalPayablePaise) }, { label: 'Paid (INR)', value: r => rupees(r.paidPaise) },
        { label: 'Outstanding (INR)', value: r => rupees(outstandingPaise(r)) }, { label: 'Due date', value: 'dueDate' }
      ], rows: fees };
    }
  },
  payments: {
    permission: 'payments.view',
    async rows({ college }) {
      const pays = await Payment.find({ college: college._id }).sort({ createdAt: -1 }).limit(MAX).lean();
      return { columns: [
        { label: 'Date', value: r => (r.paidAt || r.createdAt).toISOString() }, { label: 'Roll no', value: 'rollNoSnapshot' }, { label: 'Category', value: 'category' },
        { label: 'Amount (INR)', value: r => rupees(r.amountPaise) }, { label: 'Refunded (INR)', value: r => rupees(r.refundedPaise || 0) }, { label: 'Status', value: 'status' },
        { label: 'Provider', value: 'provider' }, { label: 'Simulated', value: r => (r.simulated ? 'yes' : 'no') }, { label: 'Receipt', value: 'receiptNo' }, { label: 'Order id', value: 'providerOrderId' }
      ], rows: pays };
    }
  },
  marks: {
    permission: 'results.view',
    label: 'Student Marks',
    async rows({ college, req }) {
      const allowed = await allowedSectionIds(req, 'results.view');
      const entries = await MarksEntry.find({ college: college._id })
        .populate({ path: 'exam', select: 'name type date maxMarks passMarks status semesterNumber section subject academicSession',
          populate: [{ path: 'subject', select: 'name code' }, { path: 'section', select: 'name sem' }, { path: 'academicSession', select: 'name' }] })
        .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } })
        .sort({ updatedAt: -1 }).limit(MAX + 1).lean();
      // a silent cut-off would hand over an incomplete file as if it were complete
      if (entries.length > MAX) throw badRequest(`There are more than ${MAX} marks entries; export is limited to ${MAX}.`, undefined, 'EXPORT_TOO_LARGE');
      const rows = entries.filter(e => e.exam && e.student && (!allowed || allowed.some(id => String(id) === String(e.exam.section && e.exam.section._id))));
      rows.sort((a, b) => (a.student.rollNo || '').localeCompare(b.student.rollNo || '') || (a.exam.date || '').localeCompare(b.exam.date || ''));
      return { columns: [
        { label: 'Roll no', value: r => r.student.rollNo }, { label: 'Student name', value: r => r.student.user && r.student.user.name },
        { label: 'Section', value: r => r.exam.section && r.exam.section.name }, { label: 'Semester', value: r => r.exam.semesterNumber },
        { label: 'Session', value: r => r.exam.academicSession && r.exam.academicSession.name },
        { label: 'Subject code', value: r => r.exam.subject && r.exam.subject.code }, { label: 'Subject', value: r => r.exam.subject && r.exam.subject.name },
        { label: 'Exam', value: r => r.exam.name }, { label: 'Exam type', value: r => r.exam.type }, { label: 'Exam date', value: r => r.exam.date },
        { label: 'Max marks', value: r => r.exam.maxMarks }, { label: 'Pass marks', value: r => r.exam.passMarks },
        { label: 'Marks', value: r => (r.absent ? '' : r.marks) }, { label: 'Absent', value: r => (r.absent ? 'yes' : 'no') },
        { label: 'Grade', value: r => r.final && r.final.grade }, { label: 'Result', value: r => (r.final && r.final.state ? r.final.state : '') },
        { label: 'Exam status', value: r => r.exam.status }, { label: 'Remark', value: 'remark' }
      ], rows };
    }
  }
};

// Downloaded file names: Students-<date>.csv and Student-Marks-<date>.csv
const FILE_LABEL = { students: 'Students', marks: 'Student-Marks' };
const kinds = () => Object.keys(DEFINITIONS);

async function exportCsv({ actor, perms, college, kind }) {
  const def = DEFINITIONS[kind];
  if (!def) throw badRequest('Unknown export.', undefined, 'UNKNOWN_EXPORT');
  if (!perms.can('reports.export') || !perms.can(def.permission)) throw forbidden(`Exporting ${kind} needs the "reports.export" and "${def.permission}" permissions.`);
  const { columns, rows } = await def.rows({ college, req: { perms, college } });
  await audit.record({ actor, collegeId: college._id, action: 'export.generated', entityType: 'Export', entityId: kind, meta: { kind, rows: rows.length } });
  return { csv: toCsv(columns, rows), rows: rows.length, filename: `${FILE_LABEL[kind] || kind}-${new Date().toISOString().slice(0, 10)}.csv` };
}

module.exports = { exportCsv, kinds };
