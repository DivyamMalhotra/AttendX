import { html, mount, delegate } from '../../utils/dom.js';
import { accessApi } from '../../api/phase2.js';
import { adminApi } from '../../api/endpoints.js';
import { cap } from '../../utils/format.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, badge, formModal, act, tabs, can } from '../../components/kit.js';
import { openModal } from '../../components/modal.js';

export default async function render({ view, ctx }) {
  mount(view, pageHeader('Roles & staff', 'Roles are sets of permissions. Nobody can grant a permission they do not hold themselves.'));
  const host = document.createElement('div');
  view.appendChild(host);
  await tabs(host, [{ key: 'staff', label: 'Staff' }, { key: 'roles', label: 'Roles' }, { key: 'depts', label: 'Departments' }], { render: (k, body) => ({ staff, roles, depts })[k](body, ctx) });
}

async function staff(body, ctx) {
  const redraw = () => staff(body, ctx);
  const [rows, roles, depts] = await Promise.all([accessApi.staff(), accessApi.roles(), accessApi.departments()]);
  const roleOpts = roles.filter(r => r.active !== false).map(r => ({ value: r._id, label: r.name }));
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="add">Add staff member</button></div>
    ${dataTable([
      { label: 'Name', render: s => html`<span class="cell-strong">${s.name}</span><div class="small muted">${s.email}</div>` },
      { label: 'Roles', render: s => html`<div class="flex gap-8 wrap">${(s.roles || []).map(r => badge('blue', r.name))}</div>` },
      { label: 'Departments', render: s => (s.departments || []).map(d => d.code).join(', ') || 'All' },
      { label: 'Status', render: s => badge(s.active ? 'green' : 'gray', s.active ? 'Active' : 'Inactive') },
      { label: '', cls: 'right', render: s => html`<button class="btn btn-outline btn-sm" data-edit="${s.id}">Change</button>` }
    ], rows, { empty: 'No staff accounts.' })}`);
  body.querySelector('#add').addEventListener('click', () => formModal({
    title: 'Add staff member', fields: [{ name: 'name', label: 'Full name', required: true }, { name: 'email', type: 'email', label: 'Email (sign-in)', required: true }, { name: 'password', type: 'password', label: 'Temporary password', required: true, autocomplete: 'new-password' },
      { name: 'roleId', type: 'select', label: 'Role', required: true, options: roleOpts }, { name: 'deptId', type: 'select', label: 'Limit to department (for department roles)', options: [{ value: '', label: 'No limit' }, ...depts.map(d => ({ value: d._id, label: d.name }))] }],
    async onSubmit(v) { await accessApi.createStaff({ name: v.name, email: v.email, password: v.password, roleIds: [v.roleId], departmentIds: v.deptId ? [v.deptId] : [] }); redraw(); }
  }));
  delegate(body, 'click', '[data-edit]', (e, b) => {
    const s = rows.find(x => x.id === b.dataset.edit);
    formModal({
      title: `Change ${s.name}`, fields: [{ name: 'roleId', type: 'select', label: 'Role', options: roleOpts, value: s.roles && s.roles[0] ? s.roles[0]._id : '' }, { name: 'active', type: 'checkbox', label: 'Active', value: s.active }],
      async onSubmit(v) { await accessApi.updateStaff(s.id, { roleIds: [v.roleId], active: v.active }); redraw(); }
    });
  });
}

async function roles(body, ctx) {
  const redraw = () => roles(body, ctx);
  const [rows, catalogue] = await Promise.all([accessApi.roles(), accessApi.permissions()]);
  const groups = [...new Set(catalogue.map(p => p.group))];
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="add">Create role</button></div>
    ${dataTable([
      { label: 'Role', render: r => html`<span class="cell-strong">${r.name}</span> ${r.builtIn ? badge('gray', 'built-in') : ''}<div class="small muted">${r.description || ''}</div>` },
      { label: 'Scope', render: r => cap(r.scope) }, { label: 'Permissions', cls: 'right', render: r => r.permissions.length },
      { label: '', cls: 'right', render: r => html`<button class="btn btn-outline btn-sm" data-view="${r._id}">${r.builtIn ? 'View' : 'Edit'}</button>` }
    ], rows)}`);
  const picker = (selected, disabled) => html`<form>${groups.map(g => html`<h4 class="card-section-label" style="margin:12px 0 4px">${g}</h4>
    ${catalogue.filter(p => p.group === g).map(p => html`<label class="check"><input type="checkbox" name="${p.key}" ${selected.includes(p.key) ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${p.label}</label>`)}`)}</form>`;
  const picked = el => [...el.querySelectorAll('input[type=checkbox]:checked')].map(i => i.name);
  body.querySelector('#add').addEventListener('click', () => {
    const m = openModal({
      title: 'Create role', wide: true, confirmText: 'Create',
      body: html`<div class="field-row"><div class="field"><label>Key (letters, digits, _)</label><input id="rk"></div><div class="field"><label>Name</label><input id="rn"></div></div>
        <div class="field"><label>Scope</label><select id="rs"><option value="college">Whole college</option><option value="department">Own departments only</option></select></div>${picker([], false)}`,
      async onConfirm(el) { await accessApi.createRole({ key: el.querySelector('#rk').value, name: el.querySelector('#rn').value, scope: el.querySelector('#rs').value, permissions: picked(el) }); redraw(); }
    });
    return m;
  });
  delegate(body, 'click', '[data-view]', (e, b) => {
    const r = rows.find(x => x._id === b.dataset.view);
    openModal({
      title: r.name, wide: true, confirmText: 'Save', footer: !r.builtIn, body: picker(r.permissions, r.builtIn),
      onConfirm: r.builtIn ? undefined : async el => { await accessApi.updateRole(r._id, { permissions: picked(el) }); redraw(); }
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
