import { html, mount, delegate } from '../../utils/dom.js';
import { studentApi, dutyLeaveApi } from '../../api/endpoints.js';
import { leaveTypesApi } from '../../api/phase2.js';
import { pageHeader, statusBadge, emptyState } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { readForm, requireFields } from '../../components/forms.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { formatDate, formatDateTime, todayISO } from '../../utils/format.js';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export default async function render({ view, refresh }) {
  const [requests, types] = await Promise.all([studentApi.dutyLeaves(), leaveTypesApi.forStudent()]);

  mount(view, html`
    ${pageHeader('Leave', 'Apply for duty, medical or personal leave. Your section mentor reviews duty and personal leave; medical leave goes to the designated reviewer.',
      html`<button type="button" class="btn btn-primary" id="applyBtn">${icons.plus} Apply for leave</button>`)}
    ${requests.length ? requests.map(r => html`
      <div class="card card-pad" style="margin-bottom:12px">
        <div class="flex-between wrap">
          <div><div class="small muted">${r.leaveType ? r.leaveType.name : 'Duty leave'}</div><div class="strong">${formatDate(r.fromDate)}${r.toDate !== r.fromDate ? ` – ${formatDate(r.toDate)}` : ''}</div>
            <div class="muted small mt-8">${r.reason}</div></div>
          ${statusBadge(r.status)}
        </div>
        ${r.remark ? html`<p class="small mt-8" style="margin-bottom:0"><b>Reviewer remark:</b> ${r.remark}</p>` : ''}
        <div class="small faint mt-8">Submitted ${formatDateTime(r.createdAt)}${r.mentor ? ` · Reviewer: ${r.mentor}` : ' · Reviewed by the HOD'}</div>
        <div class="flex gap-8 wrap mt-12">
          ${r.hasDocument ? html`<button type="button" class="btn btn-outline btn-sm" data-doc="${r.id}">${icons.download} Supporting document</button>` : ''}
          ${r.status === 'pending' ? html`<button type="button" class="btn btn-ghost btn-sm" data-cancel="${r.id}">Cancel request</button>` : ''}
        </div>
      </div>`) : html`<div class="card">${emptyState("You haven't applied for duty leave yet.")}</div>`}
    <p class="small muted">Pending or rejected requests never change attendance. Whether an approved leave counts towards attendance depends on its type, as set by the college.</p>
  `);

  delegate(view, 'click', '[data-doc]', (e, btn) => dutyLeaveApi.document(btn.dataset.doc).catch(err => toast(err.message, 'error')));
  delegate(view, 'click', '[data-cancel]', async (e, btn) => {
    if (!await confirmDialog({ title: 'Cancel request', message: 'Cancel this duty leave request? The dates will be released.', confirmText: 'Cancel request', danger: true })) return;
    try { await studentApi.cancelDutyLeave(btn.dataset.cancel); toast('Request cancelled.', 'success'); refresh(); } catch (err) { toast(err.message, 'error'); }
  });

  view.querySelector('#applyBtn').addEventListener('click', () => openModal({
    title: 'Apply for leave',
    confirmText: 'Submit request',
    body: html`<form>
      <div class="field"><label for="dlType">Type of leave</label><select id="dlType" name="leaveTypeId">${types.map(t => html`<option value="${t.id}">${t.name}${t.requiresDocument ? ' (document required)' : ''}</option>`)}</select>
        <div class="field-hint" id="dlTypeHint">${types[0] ? types[0].description : ''}</div></div>
      <div class="field-row">
        <div class="field"><label for="dlFrom">From</label><input id="dlFrom" name="fromDate" type="date" value="${todayISO()}" required></div>
        <div class="field"><label for="dlTo">To</label><input id="dlTo" name="toDate" type="date" value="${todayISO()}" required></div>
      </div>
      <div class="field"><label for="dlReason">Reason</label><textarea id="dlReason" name="reason" maxlength="500" placeholder="e.g. Representing the college at the inter-university sports meet" required></textarea></div>
      <div class="field"><label for="dlDoc">Supporting document <span class="faint">(optional)</span></label><input id="dlDoc" name="document" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg">
        <div class="field-hint">PDF, PNG or JPEG, up to 2 MB.</div></div>
    </form>`,
    onOpen(el) {
      el.querySelector('#dlType').addEventListener('change', e => {
        const t = types.find(x => x.id === e.target.value);
        el.querySelector('#dlTypeHint').textContent = [t && t.description, t && t.maxDaysPerRequest ? `Up to ${t.maxDaysPerRequest} days per request.` : ''].filter(Boolean).join(' ');
      });
    },
    async onConfirm(el, { showError }) {
      const missing = requireFields(el, ['fromDate', 'toDate', 'reason']);
      if (missing) { showError(missing); return false; }
      const v = readForm(el);
      const chosen = types.find(t => t.id === v.leaveTypeId);
      if (chosen && chosen.requiresDocument && !v.document) { showError(`${chosen.name} needs a supporting document.`); return false; }
      if (v.toDate < v.fromDate) { showError('The "To" date cannot be before the "From" date.'); return false; }
      if (v.document) {
        if (!TYPES.includes(v.document.type)) { showError('Attach a PDF, PNG or JPEG file.'); return false; }
        if (v.document.size > MAX_BYTES) { showError('The file is larger than 2 MB.'); return false; }
      }
      const form = new FormData();
      form.append('leaveTypeId', v.leaveTypeId); form.append('fromDate', v.fromDate); form.append('toDate', v.toDate); form.append('reason', v.reason);
      if (v.document) form.append('document', v.document);
      await studentApi.applyDutyLeave(form);
      toast('Duty leave request sent.', 'success');
      refresh();
    }
  }));
}
