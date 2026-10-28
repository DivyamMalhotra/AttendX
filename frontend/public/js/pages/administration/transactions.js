import { html, mount, delegate, debounce } from '../../utils/dom.js';
import { feeAdminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState, statusBadge, pager } from '../../components/ui.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { formatMoney, formatDateTime } from '../../utils/format.js';

const f = { status: '', from: '', to: '', q: '', needsReview: false, page: 1, refocus: false };
const query = () => ({ status: f.status || undefined, from: f.from || undefined, to: f.to || undefined, q: f.q || undefined, needsReview: f.needsReview ? 'true' : undefined });

export default async function render({ view, refresh }) {
  const { rows, meta } = await feeAdminApi.transactions({ ...query(), page: f.page, limit: 25 });

  mount(view, html`
    ${pageHeader('Transactions', 'Every payment attempt. Only the payment gateway can confirm a payment: use “Reconcile” to ask it for the latest status.',
      html`<button type="button" class="btn btn-outline" id="exportTx">Export CSV</button>`)}
    <div class="toolbar">
      <input type="search" id="tq" placeholder="Roll no, order, payment or receipt id" aria-label="Search transactions" value="${f.q}" style="min-width:250px">
      <select id="tStatus" aria-label="Status"><option value="">Any status</option>${['success', 'pending', 'failed', 'cancelled', 'created'].map(s => html`<option value="${s}" ${f.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`)}</select>
      <label class="small muted" for="tFrom">From</label><input type="date" id="tFrom" value="${f.from}">
      <label class="small muted" for="tTo">To</label><input type="date" id="tTo" value="${f.to}">
      <label class="check" style="margin:0"><input type="checkbox" id="tReview" ${f.needsReview ? 'checked' : ''}> Needs review only</label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Roll No</th><th>Student</th><th>Semester</th><th class="right">Amount</th><th>Status</th><th>Receipt</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map(t => html`<tr>
        <td class="small">${formatDateTime(t.paidAt || t.createdAt)}</td><td class="roll">${t.rollNoSnapshot}</td><td class="cell-strong">${t.student?.user?.name || ''}</td>
        <td>${t.academicSession?.name} · ${t.semesterNumber}</td><td class="right num">${formatMoney(t.amountPaise)}</td>
        <td>${statusBadge(t.status)} ${t.simulated ? html`<span class="badge badge-amber">TEST</span>` : ''} ${t.needsReview ? html`<span class="badge badge-red">Review</span>` : ''}</td>
        <td class="small">${t.receiptNo || '—'}</td>
        <td class="right">
          <button type="button" class="btn btn-outline btn-sm" data-detail="${t._id}">Details</button>
          ${['created', 'pending'].includes(t.status) || (t.status === 'success' && !t.receiptNo) ? html`<button type="button" class="btn btn-ghost btn-sm" data-reconcile="${t._id}">Reconcile</button>` : ''}
        </td></tr>`) : html`<tr><td colspan="8">${emptyState('No transactions match.')}</td></tr>`}</tbody></table></div>
    ${pager(meta)}`);

  const search = view.querySelector('#tq');
  search.addEventListener('input', debounce(e => { f.q = e.target.value.trim(); f.page = 1; f.refocus = true; refresh(); }, 400));
  if (f.refocus) { requestAnimationFrame(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }); f.refocus = false; }
  [['#tStatus', 'status'], ['#tFrom', 'from'], ['#tTo', 'to']].forEach(([sel, key]) => view.querySelector(sel).addEventListener('change', e => { f[key] = e.target.value; f.page = 1; refresh(); }));
  view.querySelector('#tReview').addEventListener('change', e => { f.needsReview = e.target.checked; f.page = 1; refresh(); });
  delegate(view, 'click', '[data-page]', (e, b) => { f.page = Number(b.dataset.page); refresh(); });
  view.querySelector('#exportTx').addEventListener('click', () => feeAdminApi.exportTransactions(query()).catch(err => toast(err.message, 'error')));

  delegate(view, 'click', '[data-reconcile]', async (e, b) => {
    b.disabled = true;
    try { const p = await feeAdminApi.reconcile(b.dataset.reconcile); toast(`Gateway status: ${p.status}.`, p.status === 'success' ? 'success' : 'info'); refresh(); }
    catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });

  delegate(view, 'click', '[data-detail]', async (e, b) => {
    b.disabled = true;
    let t;
    try { t = await feeAdminApi.transaction(b.dataset.detail); } catch (err) { toast(err.message, 'error'); return; } finally { b.disabled = false; }
    openModal({
      title: 'Transaction details', wide: true, footer: false,
      body: html`<dl class="kv">
        <dt>Transaction ID</dt><dd class="small">${t._id}</dd><dt>Student</dt><dd>${t.student?.user?.name} (${t.rollNoSnapshot})</dd>
        <dt>Amount</dt><dd>${formatMoney(t.amountPaise)} ${t.currency}</dd><dt>Status</dt><dd>${statusBadge(t.status)}${t.simulated ? ' (simulated test payment)' : ''}</dd>
        <dt>Provider</dt><dd>${t.provider}</dd><dt>Gateway order</dt><dd class="small">${t.providerOrderId}</dd><dt>Gateway payment</dt><dd class="small">${t.providerPaymentId || '—'}</dd>
        <dt>Receipt</dt><dd>${t.receiptNo || '—'}</dd><dt>Applied to fee</dt><dd>${t.applied ? 'Yes' : 'No'}${t.needsReview ? ' — needs administrator review' : ''}</dd>
        ${t.failureReason ? html`<dt>Failure reason</dt><dd>${t.failureReason}</dd>` : ''}</dl>
        <h4 class="card-section-label mt-16">Event trail</h4>
        ${(t.events || []).map(ev => html`<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line)"><b>${ev.type}</b> · ${formatDateTime(ev.at)}${ev.detail ? html` · <span class="muted">${typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail)}</span>` : ''}</div>`)}
        ${t.receiptId ? html`<div class="mt-16"><button type="button" class="btn btn-outline" id="dlReceipt">${icons.download} Download receipt</button></div>` : ''}`,
      onOpen(el) {
        el.querySelector('#dlReceipt')?.addEventListener('click', () => feeAdminApi.receipt(t.receiptId).catch(err => toast(err.message, 'error')));
      }
    });
  });
}
