import { html, mount, delegate } from '../../utils/dom.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState, pager } from '../../components/ui.js';
import { formatDateTime } from '../../utils/format.js';

const f = { action: '', page: 1 };
const GROUPS = [['', 'All activity'], ['auth', 'Sign-ins'], ['attendance', 'Attendance'], ['dutyleave', 'Duty leave'], ['student', 'Students'], ['fee', 'Fees'], ['payment', 'Payments'], ['settings', 'Settings']];

export default async function render({ view, refresh }) {
  const { rows, meta } = await adminApi.auditLog({ action: f.action || undefined, page: f.page, limit: 40 });
  mount(view, html`
    ${pageHeader('Audit Log', 'A permanent, read-only record of important actions. Entries cannot be edited or deleted.')}
    <div class="toolbar"><label class="small muted" for="aFilter">Show</label>
      <select id="aFilter">${GROUPS.map(([v, l]) => html`<option value="${v}" ${f.action === v ? 'selected' : ''}>${l}</option>`)}</select></div>
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => html`<tr>
        <td class="small">${formatDateTime(r.createdAt)}</td>
        <td><div class="cell-strong">${r.actorName}</div><div class="small faint">${r.actorRole}</div></td>
        <td><code>${r.action}</code></td>
        <td class="small muted wrap-cell" style="max-width:380px;overflow-wrap:anywhere">${r.entityType ? `${r.entityType} ${String(r.entityId).slice(-6)}` : ''}${r.meta && Object.keys(r.meta).length ? ` · ${JSON.stringify(r.meta).slice(0, 160)}` : ''}</td></tr>`)
        : html`<tr><td colspan="4">${emptyState('No activity recorded.')}</td></tr>`}</tbody></table></div>
    ${pager(meta)}`);
  view.querySelector('#aFilter').addEventListener('change', e => { f.action = e.target.value; f.page = 1; refresh(); });
  delegate(view, 'click', '[data-page]', (e, b) => { f.page = Number(b.dataset.page); refresh(); });
}
