import { html, mount } from '../../utils/dom.js';
import { feeAdminApi } from '../../api/endpoints.js';
import { financeApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { statCards, can } from '../../components/kit.js';
import { formatMoney } from '../../utils/format.js';

/** Fees → Overview: where the college's fees stand, and the doors to the other fee pages. */
export default async function render({ view, ctx }) {
  const [s, pending] = await Promise.all([
    feeAdminApi.summary(),
    can(ctx, 'refunds.approve') ? financeApi.refunds({ status: 'requested', limit: 1 }).catch(() => null) : null
  ]);
  const count = k => (s.byStatus[k] ? s.byStatus[k].count : 0);
  const waiting = pending ? (pending.meta.total ?? pending.rows.length) : null;
  const links = [
    ['#fees/structures', 'Structures', 'Define what each course and semester costs.', ['fees.configure', 'fees.view']],
    ['#fees/assign', 'Assign', 'Give a fee structure to a section or to students, and apply concessions.', ['fees.assign', 'fees.view']],
    ['#fees/transactions', 'Transactions', 'Every payment attempt, with receipts and reconciliation.', ['payments.view']],
    ['#fees/reports', 'Reports', 'Outstanding fees by session, section and semester, with CSV export.', ['fees.view']],
    ['#fees/refunds', 'Refunds & late fees', 'Refund approvals, the late-fee policy and waivers.', ['refunds.request', 'refunds.approve', 'latefees.waive', 'fees.configure']]
  ].filter(l => can(ctx, ...l[3]));

  mount(view, html`
    ${pageHeader('Fees overview', 'Verified payments against what has been assigned to students.')}
    ${statCards([
      { label: 'Assigned', value: formatMoney(s.payablePaise), hint: 'Total payable across all fees' },
      { label: 'Collected', value: formatMoney(s.collectedPaise), hint: 'Verified payments' },
      { label: 'Outstanding', value: formatMoney(s.outstandingPaise), tone: s.outstandingPaise ? 'red' : '', hint: 'Still to be paid' },
      { label: 'Needs reconciliation', value: s.needsReview, tone: s.needsReview ? 'red' : '', hint: 'Verified but not applied' }
    ])}
    <section><div class="sec-head"><h2>Payments by status</h2></div>
      <div class="rows">
        <div class="row-item"><div class="title">Successful</div><b class="num">${count('success')}</b></div>
        <div class="row-item"><div class="title">Pending</div><b class="num">${count('pending')}</b></div>
        <div class="row-item"><div class="title">Failed</div><b class="num">${count('failed')}</b></div>
        ${waiting !== null ? html`<div class="row-item"><div class="title">Refunds waiting for approval</div><b class="num ${waiting ? 'text-red' : ''}">${waiting}</b></div>` : ''}
      </div></section>
    <section class="mt-24"><div class="sec-head"><h2>Go to</h2></div>
      <div class="rows">${links.map(l => html`<div class="row-item"><div><div class="title">${l[1]}</div><div class="meta">${l[2]}</div></div><a class="btn btn-outline btn-sm" href="${l[0]}">Open</a></div>`)}</div></section>`);
}
