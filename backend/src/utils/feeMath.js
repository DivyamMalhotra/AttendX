/**
 * Outstanding Balance = Total Payable - Verified Payments
 * where Total Payable already contains concessions/charges (see FeeAssignment adjustments).
 * Never negative: an assignment cannot be over-collected (guarded in the payment finalizer).
 */
const outstandingPaise = a => Math.max(0, a.totalPayablePaise - a.paidPaise);

/** paid | partial | unpaid, plus an overdue flag when a due date has passed with a balance. */
function feeStatus(a, today) {
  const outstanding = outstandingPaise(a);
  let status = 'unpaid';
  if (outstanding === 0) status = 'paid';
  else if (a.paidPaise > 0) status = 'partial';
  const overdue = outstanding > 0 && Boolean(a.dueDate) && Boolean(today) && a.dueDate < today;
  return { status, overdue, outstandingPaise: outstanding };
}

const sumComponents = components => components.reduce((t, c) => t + c.amountPaise, 0);

module.exports = { outstandingPaise, feeStatus, sumComponents };
