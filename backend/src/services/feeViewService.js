const { FeeAssignment, Payment, Receipt, Section, AcademicSession } = require('../models');
const { feeStatus } = require('../utils/feeMath');
const { todayISO } = require('../utils/dates');

const presentAssignment = (a, sessions, today) => ({
  id: String(a._id),
  category: a.category || 'semester',
  description: a.description || '',
  academicSession: sessions.get(String(a.academicSession)) || null,
  semesterNumber: a.semesterNumber,
  course: a.course, specialization: a.specialization,
  components: a.components, grossPaise: a.grossPaise, adjustments: a.adjustments,
  totalPayablePaise: a.totalPayablePaise, paidPaise: a.paidPaise, dueDate: a.dueDate,
  ...feeStatus(a, today)
});

/**
 * The student's fee dashboard data. Everything comes from the student's own assignments
 * and verified payments: nothing is hardcoded or supplied by the browser.
 */
async function studentSummary({ college, profile }) {
  const [assignments, sessionDocs, section] = await Promise.all([
    FeeAssignment.find({ student: profile._id }).lean(),
    AcademicSession.find({ college: college._id }).lean(),
    Section.findById(profile.section).lean()
  ]);
  const sessions = new Map(sessionDocs.map(s => [String(s._id), { id: String(s._id), name: s.name, isCurrent: s.isCurrent, startDate: s.startDate }]));
  const today = todayISO(college.settings.timezone);

  const all = assignments.map(a => presentAssignment(a, sessions, today));
  // Library fines, hostel fees and other charges are listed separately from semester fees, never merged into them.
  const charges = all.filter(r => r.category !== 'semester').sort((x, y) => y.id.localeCompare(x.id));
  const rows = all.filter(r => r.category === 'semester')
    .sort((x, y) => (y.academicSession?.startDate || '').localeCompare(x.academicSession?.startDate || '') || y.semesterNumber - x.semesterNumber);

  // "Current" = the current academic session and the semester the student's section is in; otherwise the newest.
  const current = rows.find(r => r.academicSession?.isCurrent && section && r.semesterNumber === section.semesterNumber)
    || rows.find(r => r.academicSession?.isCurrent) || rows[0] || null;

  return {
    student: { rollNo: profile.rollNo },
    section: section && { name: section.name, sem: section.sem, course: section.course, specialization: section.specialization, semesterNumber: section.semesterNumber },
    current,
    semesters: rows,
    charges,
    totals: [...rows, ...charges].reduce((t, r) => ({ payablePaise: t.payablePaise + r.totalPayablePaise, paidPaise: t.paidPaise + r.paidPaise, outstandingPaise: t.outstandingPaise + r.outstandingPaise }),
      { payablePaise: 0, paidPaise: 0, outstandingPaise: 0 }),
    partialPaymentsAllowed: college.settings.allowPartialPayments
  };
}

/** All of the student's payment attempts (every status) with their receipts. */
async function studentHistory({ college, profile }) {
  const [payments, receipts, sessionDocs] = await Promise.all([
    Payment.find({ student: profile._id }).sort({ createdAt: -1 }).limit(300).lean(),
    Receipt.find({ student: profile._id }).select('payment receiptNo').lean(),
    AcademicSession.find({ college: college._id }).select('name').lean()
  ]);
  const receiptByPayment = new Map(receipts.map(r => [String(r.payment), r]));
  const labels = new Map((await FeeAssignment.find({ _id: { $in: payments.map(p => p.assignment) }, category: { $ne: 'semester' } }).select('description').lean()).map(a => [String(a._id), a.description]));
  const sessionName = new Map(sessionDocs.map(s => [String(s._id), s.name]));

  return payments.map(p => {
    const receipt = receiptByPayment.get(String(p._id));
    return {
      id: String(p._id), transactionId: String(p._id), providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId || null,
      academicSession: sessionName.get(String(p.academicSession)) || '', semesterNumber: p.semesterNumber, category: p.category || 'semester',
      label: (p.category || 'semester') === 'semester' ? `Semester ${p.semesterNumber}` : (labels.get(String(p.assignment)) || p.category),
      amountPaise: p.amountPaise, status: p.status, simulated: p.simulated, needsReview: p.needsReview,
      createdAt: p.createdAt, paidAt: p.paidAt, failureReason: p.failureReason,
      receiptId: receipt ? String(receipt._id) : null, receiptNo: receipt ? receipt.receiptNo : null
    };
  });
}

module.exports = { studentSummary, studentHistory };
