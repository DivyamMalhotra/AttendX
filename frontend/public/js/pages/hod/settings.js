import { html, mount, $, delegate } from '../../utils/dom.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { openModal } from '../../components/modal.js';
import { readForm, requireFields, applyFieldErrors, clearFieldErrors } from '../../components/forms.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { formatDate } from '../../utils/format.js';

export default async function render({ view, refresh }) {
  const [{ settings, college }, sessions] = await Promise.all([adminApi.settings(), adminApi.academicSessions()]);

  mount(view, html`
    ${pageHeader('Settings', `${college.name} · code ${college.code}`)}
    <div class="grid-2">
      <form class="card card-pad" id="settingsForm" novalidate>
        <h3 class="card-section-label">Attendance &amp; duty leave</h3>
        <div class="field"><label for="thr">Required attendance (%)</label>
          <input id="thr" name="attendanceThreshold" type="number" min="1" max="100" step="1" value="${settings.attendanceThreshold}">
          <div class="field-hint">Students below this in any subject get an alert. Exactly at the threshold is not a shortage.</div></div>
        <div class="field"><label for="pol">Approved duty leave counts as…</label>
          <select id="pol" name="dutyLeavePolicy">
            <option value="exclude" ${settings.dutyLeavePolicy === 'exclude' ? 'selected' : ''}>Excluded — missed classes on duty leave days are removed from the total</option>
            <option value="count_present" ${settings.dutyLeavePolicy === 'count_present' ? 'selected' : ''}>Present — missed classes on duty leave days count as attended</option></select></div>
        <label class="check"><input type="checkbox" name="allowResubmitAfterRejection" ${settings.allowResubmitAfterRejection ? 'checked' : ''}> Students may re-apply for the same dates after a rejection</label>
        <div class="field"><label for="win">Faculty correction window (days)</label>
          <input id="win" name="attendanceEditWindowDays" type="number" min="0" max="365" value="${settings.attendanceEditWindowDays}">
          <div class="field-hint">Faculty can mark or correct attendance up to this many days back. Administrators have no limit.</div></div>
        <h3 class="card-section-label mt-24">Fees</h3>
        <label class="check"><input type="checkbox" name="allowPartialPayments" ${settings.allowPartialPayments ? 'checked' : ''}> Allow part payments of a semester fee</label>
        <div class="field-error hidden" id="settingsError" role="alert"></div>
        <button type="submit" class="btn btn-primary">Save settings</button>
        <p class="small muted mt-16">Changing the threshold or duty leave policy re-checks every student immediately.</p>
      </form>

      <div class="card">
        <div class="card-title"><span>Academic sessions</span><button type="button" class="btn btn-outline btn-sm" id="newSession">${icons.plus} New session</button></div>
        ${sessions.length ? sessions.map(s => html`<div class="list-row">
          <div><div class="strong">${s.name} ${s.isCurrent ? html`<span class="badge badge-blue">Current</span>` : ''}</div>
            <div class="small muted">${formatDate(s.startDate)} – ${formatDate(s.endDate)}</div></div>
          ${s.isCurrent ? '' : html`<button type="button" class="btn btn-outline btn-sm" data-current="${s._id}">Make current</button>`}</div>`)
          : emptyState('No academic sessions yet. Create one to start assigning fees.')}
      </div>
    </div>`);

  $('#settingsForm', view).addEventListener('submit', async e => {
    e.preventDefault();
    const box = $('#settingsError', view); box.classList.add('hidden'); clearFieldErrors(e.target);
    const v = readForm(e.target);
    try {
      await adminApi.updateSettings({
        attendanceThreshold: Number(v.attendanceThreshold), dutyLeavePolicy: v.dutyLeavePolicy,
        allowResubmitAfterRejection: v.allowResubmitAfterRejection, attendanceEditWindowDays: Number(v.attendanceEditWindowDays),
        allowPartialPayments: v.allowPartialPayments
      });
      toast('Settings saved.', 'success');
    } catch (err) { box.textContent = err.message; box.classList.remove('hidden'); applyFieldErrors(e.target, err.details); }
  });

  $('#newSession', view).addEventListener('click', () => openModal({
    title: 'New academic session', confirmText: 'Create',
    body: html`<form>
      <div class="field"><label for="an">Name</label><input id="an" name="name" type="text" placeholder="2026-27" maxlength="30"></div>
      <div class="field-row"><div class="field"><label for="as">Starts</label><input id="as" name="startDate" type="date"></div>
        <div class="field"><label for="ae">Ends</label><input id="ae" name="endDate" type="date"></div></div>
      <label class="check"><input type="checkbox" name="isCurrent" checked> Make this the current session</label></form>`,
    async onConfirm(el, { showError }) {
      const missing = requireFields(el, ['name', 'startDate', 'endDate']); if (missing) { showError(missing); return false; }
      await adminApi.createAcademicSession(readForm(el)); toast('Session created.', 'success'); refresh();
    }
  }));

  delegate(view, 'click', '[data-current]', async (e, b) => {
    try { await adminApi.setCurrentSession(b.dataset.current); toast('Current session updated.', 'success'); refresh(); } catch (err) { toast(err.message, 'error'); }
  });
}
