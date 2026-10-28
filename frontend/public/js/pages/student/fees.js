import { html, mount, delegate } from '../../utils/dom.js';
import { feesApi } from '../../api/endpoints.js';
import { pageHeader, statusBadge, notice, emptyState } from '../../components/ui.js';
import { formatMoney, formatDate, formatDateTime } from '../../utils/format.js';
import { startPayment } from '../../services/paymentFlow.js';
import { financeApi } from '../../api/phase2.js';
import { statusPill, act } from '../../components/kit.js';

const CATEGORY = { library_fine: 'Library fine', hostel: 'Hostel (past charge)', other: 'Other charge' };

/** Statement of the current semester: the balance and what to do about it, then the line-by-line ledger. */
function statement(fee, canPay) {
  const owed = fee.outstandingPaise > 0;
  return html`<section class="stmt" aria-label="Semester ${fee.semesterNumber} statement">
    <div class="stmt-balance">
      <div class="flex-between"><span class="lbl">Semester ${fee.semesterNumber} · ${fee.academicSession?.name || ''}</span>${statusBadge(fee.status)}</div>
      <div class="amt ${owed ? 'due' : 'clear'}">${formatMoney(fee.outstandingPaise)}</div>
      <div class="muted small">${owed ? 'Outstanding balance' : 'Paid in full. Thank you.'}${fee.dueDate ? html` · <span class="${fee.overdue ? 'text-red strong' : ''}">${fee.overdue ? 'overdue since' : 'due'} ${formatDate(fee.dueDate)}</span>` : ''}</div>
      <div class="flex gap-8 wrap mt-16">
        ${owed && canPay ? html`<button type="button" class="btn btn-primary btn-lg" data-pay="${fee.id}">Pay ${formatMoney(fee.outstandingPaise)}</button>` : ''}
        <a class="btn btn-outline btn-lg" href="#payments">All payments &amp; receipts</a>
      </div>
    </div>
    <div>
      <div class="sec-head"><h2>Fee statement</h2><span class="muted small">${[fee.course, fee.specialization].filter(Boolean).join(' · ')}</span></div>
      <table class="ledger"><caption class="sr-only">Fee breakdown</caption><tbody>
        ${fee.components.map(c => html`<tr><td>${c.name}</td><td>${formatMoney(c.amountPaise)}</td></tr>`)}
        ${fee.adjustments.map(a => html`<tr><td>${a.kind === 'concession' ? 'Less' : 'Add'}: ${a.label}</td><td class="${a.kind === 'concession' ? 'text-green' : ''}">${a.kind === 'concession' ? '−' : '+'}${formatMoney(a.amountPaise)}</td></tr>`)}
        <tr class="total"><td>Total payable</td><td>${formatMoney(fee.totalPayablePaise)}</td></tr>
        <tr><td class="muted">Paid so far</td><td class="text-green">${formatMoney(fee.paidPaise)}</td></tr>
      </tbody></table>
    </div>
  </section>`;
}

export default async function render({ view, ctx, refresh }) {
  const [s, hist, refunds] = await Promise.all([feesApi.summary(), feesApi.history().catch(() => null), financeApi.myRefunds().catch(() => [])]);
  ctx.live.on('payment.updated', refresh);
  ctx.live.on('refund.updated', refresh);
  const others = s.semesters.filter(f => !s.current || f.id !== s.current.id);
  const recent = hist ? hist.transactions.slice(0, 5) : [];

  mount(view, html`
    ${pageHeader('Fees & payments', `${s.student.rollNo}${s.section ? ` · ${[s.section.course, s.section.specialization].filter(Boolean).join(' ')}` : ''} · all fees ${formatMoney(s.totals.outstandingPaise)} outstanding of ${formatMoney(s.totals.payablePaise)}`)}
    ${s.payments.simulated ? notice('simulated', 'Payment simulator active', 'This server is in development mode: payments here are SIMULATED and no real money moves. Receipts are marked as test payments.') : ''}
    ${!s.payments.configured ? notice('warning', 'Online payments are unavailable', 'The college has not enabled online payments yet. Please pay at the college office.') : ''}
    ${s.current ? statement(s.current, s.payments.configured) : html`<div class="card">${emptyState('No semester fee has been assigned to you yet. Please contact the college office.')}</div>`}

    ${recent.length ? html`<section><div class="sec-head"><h2>Recent payments</h2><a class="btn-link" href="#payments">View all</a></div>
      <div class="rows">${recent.map(p => html`<div class="row-item"><div><div class="title">${formatMoney(p.amountPaise)} <span class="meta">· ${p.label}</span></div><div class="meta">${formatDateTime(p.paidAt || p.createdAt)}${p.simulated ? ' · test payment' : ''}${p.receiptNo ? ` · ${p.receiptNo}` : ''}</div></div>
        <div class="flex gap-8">${statusBadge(p.status)}${p.receiptId ? html`<button type="button" class="btn btn-outline btn-sm" data-receipt="${p.receiptId}">Receipt</button>` : ''}</div></div>`)}</div></section>` : ''}

    ${others.length ? html`<section class="mt-24"><div class="sec-head"><h2>Other semesters</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Session</th><th>Semester</th><th class="right">Fee</th><th class="right">Paid</th><th class="right">Outstanding</th><th>Status</th><th></th></tr></thead>
        <tbody>${others.map(f => html`<tr><td>${f.academicSession?.name || '—'}</td><td>Semester ${f.semesterNumber}</td>
          <td class="right num">${formatMoney(f.totalPayablePaise)}</td><td class="right num">${formatMoney(f.paidPaise)}</td><td class="right num">${formatMoney(f.outstandingPaise)}</td><td>${statusBadge(f.status)}</td>
          <td class="right">${f.outstandingPaise > 0 && s.payments.configured ? html`<button type="button" class="btn btn-outline btn-sm" data-pay="${f.id}">Pay</button>` : ''}</td></tr>`)}</tbody></table></div></section>` : ''}

    ${s.charges.length ? html`<section class="mt-24"><div class="sec-head"><h2>Other charges</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Charge</th><th>Type</th><th class="right">Amount</th><th class="right">Paid</th><th class="right">Outstanding</th><th>Status</th><th></th></tr></thead>
        <tbody>${s.charges.map(f => html`<tr><td>${f.description || '—'}${f.dueDate ? html`<div class="small ${f.overdue ? 'text-red' : 'faint'}">Due ${formatDate(f.dueDate)}</div>` : ''}</td><td>${CATEGORY[f.category] || f.category}</td>
          <td class="right num">${formatMoney(f.totalPayablePaise)}</td><td class="right num">${formatMoney(f.paidPaise)}</td><td class="right num">${formatMoney(f.outstandingPaise)}</td><td>${statusBadge(f.status)}</td>
          <td class="right">${f.outstandingPaise > 0 && s.payments.configured ? html`<button type="button" class="btn btn-outline btn-sm" data-pay="${f.id}">Pay</button>` : ''}</td></tr>`)}</tbody></table></div></section>` : ''}

    ${refunds.length ? html`<section class="mt-24"><div class="sec-head"><h2>Refunds</h2></div>
      <div class="rows">${refunds.map(r => html`<div class="row-item"><div><div class="title">${formatMoney(r.amountPaise)}</div><div class="meta">${formatDate(r.requestedAt)} · ${r.reason}</div></div>${statusPill(r.status)}</div>`)}</div></section>` : ''}
  `);

  delegate(view, 'click', '[data-pay]', (e, btn) => {
    const fee = [...s.semesters, ...s.charges].find(f => f.id === btn.dataset.pay);
    if (!s.payments.configured) return;
    startPayment({ fee, partialAllowed: s.partialPaymentsAllowed, collegeName: ctx.user.collegeName, onDone: refresh });
  });
  delegate(view, 'click', '[data-receipt]', (e, b) => act(() => feesApi.receipt(b.dataset.receipt)));
}
