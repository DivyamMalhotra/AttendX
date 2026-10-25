import { html, mount, delegate } from '../../utils/dom.js';
import { financeApi } from '../../api/phase2.js';
import { feeAdminApi } from '../../api/endpoints.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, statusPill, formModal, act, confirmThen, can, tabs, card } from '../../components/kit.js';
import { formatMoney, formatDate, parseRupees } from '../../utils/format.js';

export default async function render({ view, ctx }) {
  mount(view, pageHeader('Refunds & late fees', 'Refunds need one person to request and a different person to approve.'));
  const host = document.createElement('div');
  view.appendChild(host);

  const items = [];
  if (can(ctx, 'refunds.request', 'refunds.approve')) items.push({ key: 'refunds', label: 'Refunds' });
  if (can(ctx, 'fees.configure', 'fees.view', 'latefees.waive')) items.push({ key: 'late', label: 'Late fees' });
  if (can(ctx, 'fees.configure', 'fees.view')) items.push({ key: 'policy', label: 'Late-fee policy' });

  await tabs(host, items, { render: (key, body) => ({ refunds, late, policy })[key](body, ctx) });
}

async function refunds(body, ctx) {
  const redraw = () => refunds(body, ctx);
  const { rows } = await financeApi.refunds({ limit: 50 });
  mount(body, html`
    ${can(ctx, 'refunds.request') ? html`<div class="toolbar"><button type="button" class="btn btn-primary" id="newRefund">Request a refund</button></div>` : ''}
    ${dataTable([
      { label: 'Student', render: r => html`<span class="cell-strong">${r.student && r.student.user ? r.student.user.name : ''}</span><div class="small muted">${r.student ? r.student.rollNo : ''}</div>` },
      { label: 'Amount', cls: 'right', render: r => formatMoney(r.amountPaise) },
      { label: 'Reason', render: r => r.reason },
      { label: 'Requested by', render: r => r.requestedBy ? r.requestedBy.name : '' },
      { label: 'Status', render: r => statusPill(r.status) },
      { label: '', cls: 'right', render: r => html`${r.status === 'requested' && can(ctx, 'refunds.approve') ? html`<button class="btn btn-primary btn-sm" data-approve="${r._id}">Approve</button> <button class="btn btn-outline btn-sm" data-reject="${r._id}">Reject</button>` : ''}
        ${r.status === 'failed' && can(ctx, 'refunds.approve') ? html`<button class="btn btn-outline btn-sm" data-retry="${r._id}">Retry</button>` : ''}${r.failureReason ? html`<div class="small text-red">${r.failureReason}</div>` : ''}` }
    ], rows, { empty: 'No refunds yet.' })}`);

  body.querySelector('#newRefund')?.addEventListener('click', async () => {
    const { rows: pays } = await feeAdminApi.transactions({ status: 'success', limit: 100 });
    formModal({
      title: 'Request a refund', submit: 'Request refund', intro: 'Choose the verified payment and the amount to return. Another person must approve before money moves.',
      fields: [
        { name: 'paymentId', type: 'select', label: 'Payment', required: true, options: pays.map(p => ({ value: p.id || p._id, label: `${p.rollNo || p.rollNoSnapshot || ''} · ${formatMoney(p.amountPaise)} · ${formatDate(p.paidAt)}` })) },
        { name: 'amount', label: 'Refund amount (INR)', required: true, placeholder: '2500.00' },
        { name: 'reason', type: 'textarea', label: 'Reason', required: true, max: 300 },
        { name: 'reduceFee', type: 'checkbox', label: 'Also reduce the fee by this amount (for over-collection)' }
      ],
      async onSubmit(v) {
        const paise = parseRupees(v.amount);
        if (!paise) throw new Error('Enter a valid amount.');
        await financeApi.requestRefund({ paymentId: v.paymentId, amountPaise: paise, reason: v.reason, reduceFee: v.reduceFee });
        redraw();
      }
    });
  });
  delegate(body, 'click', '[data-approve]', (e, b) => confirmThen({ title: 'Approve refund', message: 'Approving sends the refund to the payment gateway.', confirmText: 'Approve', run: () => financeApi.approveRefund(b.dataset.approve), success: 'Refund approved.', after: redraw }));
  delegate(body, 'click', '[data-reject]', (e, b) => formModal({ title: 'Reject refund', submit: 'Reject', fields: [{ name: 'note', type: 'textarea', label: 'Note', max: 300 }], onSubmit: async v => { await financeApi.rejectRefund(b.dataset.reject, v.note); redraw(); } }));
  delegate(body, 'click', '[data-retry]', (e, b) => act(() => financeApi.retryRefund(b.dataset.retry), { success: 'Retried.', after: redraw }));
}

async function late(body, ctx) {
  const redraw = () => late(body, ctx);
  const { rows } = await financeApi.lateFees({ limit: 50 });
  mount(body, html`
    ${can(ctx, 'fees.configure') ? html`<div class="toolbar"><button class="btn btn-outline" id="runLate">Assess late fees now</button></div>` : ''}
    ${dataTable([
      { label: 'Student', render: r => html`<span class="cell-strong">${r.student && r.student.user ? r.student.user.name : ''}</span><div class="small muted">${r.student ? r.student.rollNo : ''}</div>` },
      { label: 'Fee', render: r => r.assignment ? `Semester ${r.assignment.semesterNumber} · due ${formatDate(r.assignment.dueDate)}` : '' },
      { label: 'Period', render: r => r.periodKey }, { label: 'Amount', cls: 'right', render: r => formatMoney(r.amountPaise) },
      { label: 'Status', render: r => statusPill(r.status) },
      { label: '', cls: 'right', render: r => (r.status === 'assessed' && r.applied && can(ctx, 'latefees.waive') ? html`<button class="btn btn-outline btn-sm" data-waive="${r._id}">Waive</button>` : '') }
    ], rows, { empty: 'No late fees have been assessed.' })}`);
  body.querySelector('#runLate')?.addEventListener('click', () => act(async () => { const r = await financeApi.runLateFees(); return r; }, { success: 'Assessment finished.', after: redraw }));
  delegate(body, 'click', '[data-waive]', (e, b) => formModal({ title: 'Waive late fee', submit: 'Waive', fields: [{ name: 'reason', type: 'textarea', label: 'Reason', max: 300 }], onSubmit: async v => { await financeApi.waive(b.dataset.waive, v.reason); redraw(); } }));
}

async function policy(body, ctx) {
  const p = await financeApi.policy();
  const editable = can(ctx, 'fees.configure');
  mount(body, card('Late-fee policy', html`<form id="pol">
    <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''} ${editable ? '' : 'disabled'}> Charge late fees on overdue fees</label>
    <div class="field-row"><div class="field"><label>Grace days</label><input name="graceDays" type="number" min="0" value="${p.graceDays ?? 0}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label>How it is calculated</label><select name="mode" ${editable ? '' : 'disabled'}><option value="flat" ${p.mode !== 'percent' ? 'selected' : ''}>Fixed amount</option><option value="percent" ${p.mode === 'percent' ? 'selected' : ''}>Percentage of the balance</option></select></div></div>
    <div class="field-row"><div class="field"><label>Fixed amount (INR)</label><input name="flat" value="${((p.flatPaise || 0) / 100).toFixed(2)}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label>Percentage</label><input name="percent" type="number" step="0.01" min="0" max="100" value="${((p.percentBp || 0) / 100)}" ${editable ? '' : 'disabled'}></div></div>
    <div class="field-row"><div class="field"><label>Repeats</label><select name="period" ${editable ? '' : 'disabled'}>${['once', 'daily', 'weekly', 'monthly'].map(x => html`<option ${p.period === x ? 'selected' : ''}>${x}</option>`)}</select></div>
      <div class="field"><label>Maximum per fee (INR, 0 = none)</label><input name="cap" value="${((p.capPaise || 0) / 100).toFixed(2)}" ${editable ? '' : 'disabled'}></div></div>
    ${editable ? html`<button class="btn btn-primary" type="submit">Save policy</button>` : ''}</form>`));
  body.querySelector('#pol')?.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements;
    act(() => financeApi.savePolicy({
      active: f.active.checked, graceDays: Number(f.graceDays.value), mode: f.mode.value, flatPaise: parseRupees(f.flat.value) ?? 0,
      percentBp: Math.round(Number(f.percent.value) * 100), period: f.period.value, capPaise: parseRupees(f.cap.value) ?? 0
    }), { success: 'Policy saved.' });
  });
}
