import { html, mount, delegate } from '../../utils/dom.js';
import { leaveTypesApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, badge, formModal } from '../../components/kit.js';

const fields = t => [
  ...(t ? [] : [{ name: 'key', label: 'Key (letters, digits, _)', required: true }]),
  { name: 'name', label: 'Name', required: true, value: t && t.name }, { name: 'description', label: 'Description', value: t && t.description },
  { name: 'exemptsAttendance', type: 'checkbox', label: 'Approved leave of this type does not count against attendance', value: t && t.exemptsAttendance },
  { name: 'requiresDocument', type: 'checkbox', label: 'A supporting document is required', value: t && t.requiresDocument },
  { name: 'sensitive', type: 'checkbox', label: 'Sensitive (only designated reviewers see reasons and documents)', value: t && t.sensitive },
  { name: 'maxDaysPerRequest', type: 'number', label: 'Longest request (days, 1–31)', value: t && t.maxDaysPerRequest, min: 1, max: 31 },
  { name: 'active', type: 'checkbox', label: 'Available to students', value: t ? t.active : true }
];
const body = v => ({ ...(v.key ? { key: v.key } : {}), name: v.name, description: v.description || undefined, exemptsAttendance: v.exemptsAttendance, requiresDocument: v.requiresDocument, sensitive: v.sensitive, active: v.active, ...(v.maxDaysPerRequest ? { maxDaysPerRequest: Number(v.maxDaysPerRequest) } : {}) });

export default async function render({ view, refresh }) {
  const rows = await leaveTypesApi.list();
  mount(view, html`${pageHeader('Leave types', 'Decide what each kind of leave does to attendance.', html`<button class="btn btn-primary" id="new">Add leave type</button>`)}
    ${dataTable([
      { label: 'Type', render: t => html`<span class="cell-strong">${t.name}</span><div class="small muted">${t.description || ''}</div>` },
      { label: 'Attendance', render: t => (t.exemptsAttendance ? badge('green', 'Not counted against') : badge('gray', 'No effect')) },
      { label: 'Rules', render: t => html`${t.requiresDocument ? badge('blue', 'document') : ''} ${t.sensitive ? badge('red', 'sensitive') : ''}` },
      { label: 'Status', render: t => badge(t.active ? 'green' : 'gray', t.active ? 'Active' : 'Off') },
      { label: '', cls: 'right', render: t => html`<button class="btn btn-outline btn-sm" data-edit="${t._id}">Edit</button>` }
    ], rows)}
    <p class="small muted">Changing a type only affects new approvals; leave already approved keeps the rule it was approved under.</p>`);
  view.querySelector('#new').addEventListener('click', () => formModal({ title: 'Add leave type', fields: fields(null), onSubmit: async v => { await leaveTypesApi.create(body(v)); refresh(); } }));
  delegate(view, 'click', '[data-edit]', (e, b) => { const t = rows.find(x => x._id === b.dataset.edit); formModal({ title: `Edit ${t.name}`, fields: fields(t), onSubmit: async v => { await leaveTypesApi.update(t._id, body(v)); refresh(); } }); });
}
