const { StudentProfile, FeeAssignment, Payment, User } = require('../models');
const { LibraryIssue } = require('../models/Facilities');
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
  loans: {
    permission: 'library.manage',
    async rows({ college }) {
      const loans = await LibraryIssue.find({ college: college._id }).populate('book', 'title').populate('copy', 'accessionNo')
        .populate({ path: 'student', select: 'rollNo user', populate: { path: 'user', select: 'name' } }).sort({ issuedOn: -1 }).limit(MAX).lean();
      return { columns: [
        { label: 'Accession', value: r => r.copy && r.copy.accessionNo }, { label: 'Title', value: r => r.book && r.book.title }, { label: 'Roll no', value: r => r.student && r.student.rollNo },
        { label: 'Student', value: r => r.student && r.student.user && r.student.user.name }, { label: 'Issued', value: 'issuedOn' }, { label: 'Due', value: 'dueDate' },
        { label: 'Returned', value: 'returnedOn' }, { label: 'Status', value: 'status' }, { label: 'Fine (INR)', value: r => rupees(r.fineAssessedPaise || 0) }
      ], rows: loans };
    }
  }
};

const kinds = () => Object.keys(DEFINITIONS);

async function exportCsv({ actor, perms, college, kind }) {
  const def = DEFINITIONS[kind];
  if (!def) throw badRequest('Unknown export.', undefined, 'UNKNOWN_EXPORT');
  if (!perms.can('reports.export') || !perms.can(def.permission)) throw forbidden(`Exporting ${kind} needs the "reports.export" and "${def.permission}" permissions.`);
  const { columns, rows } = await def.rows({ college, req: { perms, college } });
  await audit.record({ actor, collegeId: college._id, action: 'export.generated', entityType: 'Export', entityId: kind, meta: { kind, rows: rows.length } });
  return { csv: toCsv(columns, rows), rows: rows.length, filename: `${kind}-${new Date().toISOString().slice(0, 10)}.csv` };
}

module.exports = { exportCsv, kinds };
