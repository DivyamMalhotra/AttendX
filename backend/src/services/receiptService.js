const { Receipt, Payment, FeeAssignment, StudentProfile, User, College, AcademicSession, Counter } = require('../models');
const { isDuplicateKey } = require('../utils/mongoErrors');
const { forbidden, notFound } = require('../utils/errors');
const { outstandingPaise } = require('../utils/feeMath');

const pad = (n, w) => String(n).padStart(w, '0');

async function nextReceiptNo(collegeId) {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`receipt:${collegeId}:${year}`);
  return `RCP-${year}-${pad(seq, 6)}`;
}

async function buildSnapshot(payment) {
  const [college, profile, assignment, session] = await Promise.all([
    College.findById(payment.college).lean(),
    StudentProfile.findById(payment.student).lean(),
    FeeAssignment.findById(payment.assignment).lean(),
    AcademicSession.findById(payment.academicSession).lean()
  ]);
  const user = await User.findById(profile.user).select('name email').lean();
  const balanceAfter = payment.balanceAfterPaise ?? outstandingPaise(assignment);
  return {
    institution: { name: college.name, address: college.address || '' },
    transactionId: String(payment._id),
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    provider: payment.provider,
    simulated: payment.simulated,
    paidAt: payment.paidAt,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    student: { name: user.name, email: user.email, rollNo: payment.rollNoSnapshot },
    category: assignment.category || 'semester', description: assignment.description || '',
    course: assignment.course, specialization: assignment.specialization,
    semesterNumber: assignment.semesterNumber, academicSession: session ? session.name : '',
    fee: { components: assignment.components, grossPaise: assignment.grossPaise, adjustments: assignment.adjustments, totalPayablePaise: assignment.totalPayablePaise },
    balanceAfterPaise: balanceAfter,
    totalPaidAfterPaise: assignment.totalPayablePaise - balanceAfter
  };
}

/**
 * Creates the receipt for a verified, applied payment. Safe to call repeatedly or
 * concurrently: the unique index on `payment` guarantees a single receipt per payment.
 */
async function ensureReceipt(payment) {
  let receipt = await Receipt.findOne({ payment: payment._id });
  if (!receipt) {
    const receiptNo = await nextReceiptNo(payment.college);
    try {
      receipt = await Receipt.create({
        college: payment.college, payment: payment._id, student: payment.student, receiptNo, snapshot: await buildSnapshot(payment)
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      receipt = await Receipt.findOne({ payment: payment._id }); // a concurrent finalizer created it
    }
  }
  await Payment.updateOne({ _id: payment._id, receiptNo: null }, { $set: { receiptNo: receipt.receiptNo } });
  return receipt;
}

/** Receipt lookup with ownership enforced: students only ever get their own. */
async function getForViewer({ actor, college, receiptId }) {
  const receipt = await Receipt.findOne({ _id: receiptId, college: college._id });
  if (!receipt) throw notFound('Receipt not found.');
  if (actor.role === 'student') {
    const mine = await StudentProfile.exists({ _id: receipt.student, user: actor._id });
    if (!mine) throw notFound('Receipt not found.'); // do not reveal that it exists
  } else if (actor.role !== 'hod') {
    throw forbidden();
  }
  return receipt;
}

module.exports = { ensureReceipt, getForViewer };
