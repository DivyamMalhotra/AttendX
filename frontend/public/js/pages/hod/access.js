import { html, mount, delegate } from '../../utils/dom.js';
import { accessApi } from '../../api/phase2.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, badge, formModal, act, tabs, can } from '../../components/kit.js';

export default async function render({ view, ctx }) {
  mount(view, pageHeader('Staff accounts', 'Create HOD, Accounts Clerk and Exam Cell accounts. A HOD only sees the departments assigned to them.'));
  const host = document.createElement('div');
  view.appendChild(host);
  await tabs(host, [{ key: 'staff', label: 'Staff' }, { key: 'depts', label: 'Departments' }], { render: (k, body) => ({ staff, depts })[k](body, ctx) });
}

const ROLE_TITLE = { hod: 'HOD', accounts_clerk: 'Accounts Clerk', exam_cell: 'Exam Cell', teacher: 'Teacher' };

async function staff(body, ctx) {
  const redraw = () => staff(body, ctx);
  const [rows, depts] = await Promise.all([accessApi.staff(), accessApi.departments()]);
  const deptOpts = [{ value: '', label: 'None' }, ...depts.map(d => ({ value: d._id, label: `${d.name} (${d.code})` }))];
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="add">Add staff member</button></div>
    ${dataTable([
      { label: 'Name', render: s => html`<span class="cell-strong">${s.name}</span><div class="small muted">${s.email}</div>` },
      { label: 'Role', render: s => badge('blue', ROLE_TITLE[s.role] || s.role) },
      { label: 'Departments', render: s => (s.role === 'hod' ? ((s.departments || []).map(d => d.code).join(', ') || 'None assigned: sees nothing') : '\u2014') },
      { label: 'Status', render: s => badge(s.active ? 'green' : 'gray', s.active ? 'Active' : 'Inactive') },
      { label: '', cls: 'right', render: s => html`<button class="btn btn-outline btn-sm" data-edit="${s.id}">Change</button>` }
    ], rows, { empty: 'No staff accounts.' })}`);
  body.querySelector('#add').addEventListener('click', () => formModal({
    title: 'Add staff member', intro: 'The temporary password must be changed at first sign-in.',
    fields: [{ name: 'name', label: 'Full name', required: true }, { name: 'email', type: 'email', label: 'Email (sign-in)', required: true }, { name: 'password', type: 'password', label: 'Temporary password', required: true },
      { name: 'role', type: 'select', label: 'Role', required: true, options: [{ value: 'hod', label: 'HOD' }, { value: 'accounts_clerk', label: 'Accounts Clerk' }, { value: 'exam_cell', label: 'Exam Cell' }] },
      { name: 'deptId', type: 'select', label: 'Department (for a HOD)', options: deptOpts }],
    async onSubmit(v) { await accessApi.createStaff({ name: v.name, email: v.email, password: v.password, role: v.role, departmentIds: v.role === 'hod' && v.deptId ? [v.deptId] : [] }); redraw(); }
  }));
  delegate(body, 'click', '[data-edit]', (e, b) => {
    const s = rows.find(x => x.id === b.dataset.edit);
    formModal({
      title: `Change ${s.name}`,
      fields: [...(s.role === 'hod' ? [{ name: 'deptId', type: 'select', label: 'Department', options: deptOpts, value: s.departments && s.departments[0] ? s.departments[0]._id : '' }] : []), { name: 'active', type: 'checkbox', label: 'Active', value: s.active }],
      async onSubmit(v) { await accessApi.updateStaff(s.id, { active: v.active, ...(s.role === 'hod' ? { departmentIds: v.deptId ? [v.deptId] : [] } : {}) }); redraw(); }
    });
  });
}

async function depts(body, ctx) {
  const redraw = () => depts(body, ctx);
  const [rows, sections] = await Promise.all([accessApi.departments(), adminApi.sections()]);
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="add">Add department</button></div>
    ${dataTable([{ label: 'Department', render: d => html`<span class="cell-strong">${d.name}</span> <span class="faint">${d.code}</span>` }, { label: 'Head', render: d => (d.head ? d.head.name : '—') }, { label: 'Sections', cls: 'right', render: d => d.sectionCount }], rows, { empty: 'No departments yet.' })}
    <h3 class="card-section-label mt-24">Section → department</h3>
    ${dataTable([{ label: 'Section', render: s => `${s.name} · ${s.sem}` }, { label: 'Department', render: s => html`<select data-sec="${s._id}"><option value="">None</option>${rows.map(d => html`<option value="${d._id}" ${String(s.department && (s.department._id || s.department)) === String(d._id) ? 'selected' : ''}>${d.name}</option>`)}</select>` }], sections)}`);
  body.querySelector('#add').addEventListener('click', () => formModal({ title: 'Add department', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'code', label: 'Short code (e.g. CSE)', required: true }], async onSubmit(v) { await accessApi.createDepartment(v); redraw(); } }));
  delegate(body, 'change', '[data-sec]', (e, s) => act(() => accessApi.setSectionDepartment(s.dataset.sec, s.value || null), { success: 'Saved.' }));
}
