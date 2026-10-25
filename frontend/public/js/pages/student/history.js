import { html, mount, delegate } from '../../utils/dom.js';
import { feesApi } from '../../api/endpoints.js';
import { pageHeader, statusBadge, emptyState } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { formatMoney, formatDateTime } from '../../utils/format.js';

export default async function render({ view, refresh }) {
  const { transactions, semesters, totals } = await feesApi.history();

  mount(view, html`
    ${pageHeader('Payment History & Receipts', 'Every payment attempt recorded for your account, and receipts for verified payments.')}
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total payable</div><div class="stat-value">${formatMoney(totals.payablePaise)}</div></div>
      <div class="stat-card"><div class="stat-label">Paid</div><div class="stat-value text-green">${formatMoney(totals.paidPaise)}</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding</div><div class="stat-value ${totals.outstandingPaise ? 'text-red' : ''}">${formatMoney(totals.outstandingPaise)}</div></div>
    </div>

    <h3 class="card-section-label">By semester</h3>
    ${semesters.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Academic year</th><th>Semester</th><th class="right">Semester fee</th><th class="right">Amount paid</th><th class="right">Outstanding</th><th>Status</th></tr></thead>
      <tbody>${semesters.map(f => html`<tr><td>${f.academicSession?.name || '—'}</td><td>Semester ${f.semesterNumber}</td>
        <td class="right num">${formatMoney(f.totalPayablePaise)}</td><td class="right num">${formatMoney(f.paidPaise)}</td>
        <td class="right num">${formatMoney(f.outstandingPaise)}</td><td>${statusBadge(f.status)}</td></tr>`)}</tbody></table></div>`
      : html`<div class="card">${emptyState('No fee records yet.')}</div>`}

    <h3 class="card-section-label mt-24">Transactions</h3>
    ${transactions.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Transaction ID</th><th>Semester</th><th class="right">Amount</th><th>Status</th><th>Receipt no.</th><th></th></tr></thead>
      <tbody>${transactions.map(t => html`<tr>
        <td>${formatDateTime(t.paidAt || t.createdAt)}</td>
        <td class="small" title="${t.providerOrderId}">${t.transactionId.slice(-10).toUpperCase()}</td>
        <td>${t.academicSession} · Sem ${t.semesterNumber}</td>
        <td class="right num">${formatMoney(t.amountPaise)}</td>
        <td>${statusBadge(t.status)} ${t.simulated ? html`<span class="badge badge-amber" title="Simulated payment">TEST</span>` : ''}
          ${t.needsReview ? html`<span class="badge badge-amber" title="Verified, awaiting administrator reconciliation">Review</span>` : ''}</td>
        <td>${t.receiptNo || '—'}</td>
        <td class="right">
          ${t.receiptId ? html`<button type="button" class="btn btn-outline btn-sm receipt-link" data-receipt="${t.receiptId}">${icons.download} Receipt</button>` : ''}
          ${['created', 'pending'].includes(t.status) ? html`<button type="button" class="btn btn-ghost btn-sm" data-sync="${t.providerOrderId}">Check status</button>` : ''}
        </td></tr>`)}</tbody></table></div>`
      : html`<div class="card">${emptyState("You haven't made any payments yet.")}</div>`}
    <p class="small muted mt-16">Receipts are issued only after a payment has been verified with the payment gateway. Pending or failed payments do not change your balance.</p>
  `);

  delegate(view, 'click', '[data-receipt]', async (e, btn) => {
    btn.disabled = true;
    try { await feesApi.receipt(btn.dataset.receipt); } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
  delegate(view, 'click', '[data-sync]', async (e, btn) => {
    btn.disabled = true;
    try {
      const p = await feesApi.sync(btn.dataset.sync);
      toast(p.status === 'success' ? 'Payment confirmed.' : `Status: ${p.status}.`, p.status === 'success' ? 'success' : 'info');
      refresh();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
}
