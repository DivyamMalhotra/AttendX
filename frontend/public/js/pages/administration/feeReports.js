import { html, mount } from '../../utils/dom.js';
import { adminApi, feeAdminApi } from '../../api/endpoints.js';
import { api } from '../../api/client.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, act, can } from '../../components/kit.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const filters = { sessionId: '', sectionId: '', semesterNumber: '' };

/** Fees → Reports: the existing "outstanding fees" report and the existing transaction export. */
export default async function render({ view, ctx, refresh }) {
  const [sections, sessions] = await Promise.all([adminApi.sections(), adminApi.academicSessions()]);
  const query = { sessionId: filters.sessionId || undefined, sectionId: filters.sectionId || undefined, semesterNumber: filters.semesterNumber || undefined };
  const rows = await api.get('/api/admin/fees/reports/outstanding', query);
  const total = rows.reduce((t, r) => t + (r.totalPayablePaise - r.paidPaise), 0);

  mount(view, html`
    ${pageHeader('Fee reports', 'Students who still owe fees. The same list can be downloaded as a spreadsheet.',
      html`<button type="button" class="btn btn-outline" id="csvOut">Download outstanding (CSV)</button>${can(ctx, 'payments.view') ? html`<button type="button" class="btn btn-outline" id="csvTx">Download transactions (CSV)</button>` : ''}`)}
    <div class="toolbar">
      <select id="fSession" aria-label="Academic session"><option value="">All sessions</option>${sessions.map(s => html`<option value="${s._id}" ${filters.sessionId === s._id ? 'selected' : ''}>${s.name}</option>`)}</select>
      <select id="fSection" aria-label="Section"><option value="">All sections</option>${sections.map(s => html`<option value="${s._id}" ${filters.sectionId === s._id ? 'selected' : ''}>${s.name} · ${s.sem}</option>`)}</select>
      <select id="fSem" aria-label="Semester"><option value="">All semesters</option>${Array.from({ length: 8 }, (_, i) => html`<option value="${i + 1}" ${String(filters.semesterNumber) === String(i + 1) ? 'selected' : ''}>Semester ${i + 1}</option>`)}</select>
    </div>
    <p class="muted small">${rows.length} fee${rows.length === 1 ? '' : 's'} outstanding · ${formatMoney(total)} in total${rows.length >= 5000 ? ' (first 5,000 shown)' : ''}</p>
    ${dataTable([
      { label: 'Roll no', render: r => r.student ? r.student.rollNo : '' }, { label: 'Student', render: r => r.student && r.student.user ? r.student.user.name : '' },
      { label: 'Section', render: r => r.student && r.student.section ? r.student.section.name : '' }, { label: 'Session', render: r => r.academicSession ? r.academicSession.name : '' },
      { label: 'Semester', render: r => r.semesterNumber || '—' }, { label: 'Payable', cls: 'right', render: r => formatMoney(r.totalPayablePaise) },
      { label: 'Outstanding', cls: 'right', render: r => formatMoney(r.totalPayablePaise - r.paidPaise) }, { label: 'Due', render: r => (r.dueDate ? formatDate(r.dueDate) : '—') }
    ], rows, { empty: 'No outstanding fees match these filters.' })}`);

  const bind = (id, key) => view.querySelector(id).addEventListener('change', e => { filters[key] = e.target.value; refresh(); });
  bind('#fSession', 'sessionId'); bind('#fSection', 'sectionId'); bind('#fSem', 'semesterNumber');
  view.querySelector('#csvOut').addEventListener('click', () => act(() => feeAdminApi.exportOutstanding(query)));
  view.querySelector('#csvTx')?.addEventListener('click', () => act(() => feeAdminApi.exportTransactions({})));
}
