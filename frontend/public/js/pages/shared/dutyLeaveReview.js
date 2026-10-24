import { html, mount, delegate } from '../../utils/dom.js';
import { dutyLeaveApi } from '../../api/endpoints.js';
import { pageHeader, statusBadge, emptyState, pager } from '../../components/ui.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { formatDate, formatDateTime } from '../../utils/format.js';

/**
 * Duty leave review queue, shared by mentors (faculty) and the HOD.
 * The server decides what each role may see and do; this page only renders it.
 */
export async function renderDutyLeaveReview({ view, refresh, subtitle }) {
  let status = 'pending';
  let page = 1;

  async function paint() {
    const { rows, meta } = await dutyLeaveApi.queue({ status: status || undefined, page, limit: 20 });
    mount(view, html`
      ${pageHeader('Duty Leave Requests', subtitle)}
      <div class="toolbar">
        <label class="small muted" for="statusFilter">Show</label>
        <select id="statusFilter">
          ${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['', 'All']].map(([v, l]) => html`<option value="${v}" ${v === status ? 'selected' : ''}>${l}</option>`)}
        </select>
      </div>
      ${rows.length ? rows.map(r => html`<div class="card card-pad" style="margin-bottom:12px">
        <div class="flex-between wrap">
          <div><div class="strong">${r.student?.name || 'Student'}</div>
            <div class="muted small">${r.student?.rollNo || ''}${r.student?.section ? ` · ${r.student.section.name}` : ''} · ${formatDate(r.fromDate)}${r.toDate !== r.fromDate ? ` – ${formatDate(r.toDate)}` : ''}</div></div>
          ${statusBadge(r.status)}
        </div>
        <p style="margin:10px 0 0">${r.reason}</p>
        ${r.remark ? html`<p class="small muted" style="margin:6px 0 0"><b>Remark:</b> ${r.remark}</p>` : ''}
        <div class="small faint mt-8">Submitted ${formatDateTime(r.createdAt)}</div>
        <div class="flex gap-8 wrap mt-12">
          ${r.hasDocument ? html`<button type="button" class="btn btn-outline btn-sm" data-doc="${r.id}">${icons.download} View document</button>` : ''}
          ${r.status === 'pending' ? html`
            <button type="button" class="btn btn-success-soft btn-sm" data-decide="approved" data-id="${r.id}">Approve</button>
            <button type="button" class="btn btn-danger-soft btn-sm" data-decide="rejected" data-id="${r.id}">Reject</button>` : ''}
        </div>
      </div>`) : html`<div class="card">${emptyState(status === 'pending' ? 'No pending requests. 🎉' : 'No requests to show.')}</div>`}
      ${pager(meta)}`);

    view.querySelector('#statusFilter').addEventListener('change', e => { status = e.target.value; page = 1; paint(); });
    view.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { page = Number(b.dataset.page); paint(); }));
  }

  delegate(view, 'click', '[data-doc]', (e, btn) => dutyLeaveApi.document(btn.dataset.doc).catch(err => toast(err.message, 'error')));
  delegate(view, 'click', '[data-decide]', (e, btn) => {
    const decision = btn.dataset.decide;
    openModal({
      title: decision === 'approved' ? 'Approve duty leave' : 'Reject duty leave',
      confirmText: decision === 'approved' ? 'Approve' : 'Reject',
      body: html`<form><p class="muted small" style="margin-top:0">${decision === 'approved'
        ? 'Approved days will be excluded from the student’s attendance calculation according to the college policy.'
        : 'The student will be told the request was rejected and can see your remark.'}</p>
        <div class="field"><label for="rm">Remark <span class="faint">(optional)</span></label><textarea id="rm" name="remark" maxlength="500"></textarea></div></form>`,
      async onConfirm(el) {
        await dutyLeaveApi.review(btn.dataset.id, { decision, remark: el.querySelector('[name=remark]').value.trim() || undefined });
        toast(`Request ${decision}.`, 'success');
        paint();
      }
    });
  });
  await paint();
}
