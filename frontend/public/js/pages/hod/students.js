import { html, mount, delegate, debounce } from '../../utils/dom.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState, pager } from '../../components/ui.js';
import { openModal } from '../../components/modal.js';
import { readForm, requireFields } from '../../components/forms.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { initials } from '../../utils/format.js';

// Filters survive refreshes within the session.
const filters = { q: '', sectionId: '', includeInactive: false, page: 1, refocusSearch: false, layout: 'table' };
const takeHandoff = () => { try { const v = sessionStorage.getItem('attendx.q.students'); if (v) { sessionStorage.removeItem('attendx.q.students'); return v; } } catch (e) { /* ignore */ } return null; };

export default async function render({ view, refresh }) {
  const handed = takeHandoff();
  if (handed) { filters.q = handed; filters.page = 1; }
  const sections = await adminApi.sections();
  const { rows, meta } = await adminApi.students({
    q: filters.q || undefined, sectionId: filters.sectionId || undefined,
    includeInactive: filters.includeInactive || undefined, page: filters.page, limit: 25
  });

  mount(view, html`
    ${pageHeader('Students', `${meta.total} ${filters.includeInactive ? 'records' : 'enrolled'}`,
      html`<button type="button" class="btn btn-primary" id="addStudent">${icons.plus} Add Student</button>`)}
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search name, email or roll no." aria-label="Search students" value="${filters.q}" style="min-width:240px">
      <select id="sectionFilter" aria-label="Filter by section"><option value="">All sections</option>
        ${sections.map(s => html`<option value="${s._id}" ${filters.sectionId === s._id ? 'selected' : ''}>${s.name} · ${s.sem}</option>`)}</select>
      <label class="check" style="margin:0"><input type="checkbox" id="inactive" ${filters.includeInactive ? 'checked' : ''}> Show inactive</label>
      <div class="view-toggle" role="group" aria-label="Layout"><button type="button" data-layout="table" class="${filters.layout === 'table' ? 'on' : ''}" aria-pressed="${filters.layout === 'table'}">Table</button><button type="button" data-layout="grid" class="${filters.layout === 'grid' ? 'on' : ''}" aria-pressed="${filters.layout === 'grid'}">Directory</button></div>
    </div>
    ${filters.layout === 'grid' ? (rows.length ? html`<div class="dir-grid">${rows.map(s => html`<article class="person ${s.active ? '' : 'faint'}"><span class="avatar" aria-hidden="true">${initials(s.name)}</span>
      <div><div class="p-name">${s.name}</div><div class="p-meta">${s.rollNo}${s.section ? ` · ${s.section.name}` : ''}</div><div class="p-meta">${s.email}</div>
      <div class="p-actions">${s.active ? '' : html`<span class="badge badge-gray">Inactive</span> `}<button type="button" class="btn btn-outline btn-sm" data-edit="${s.id}">Edit</button></div></div></article>`)}</div>` : emptyState('No students match.')) : html`
    <div class="table-wrap"><table>
      <thead><tr><th>Roll No</th><th>Name</th><th>Email</th><th>Section</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map(s => html`<tr class="${s.active ? '' : 'faint'}">
        <td class="roll">${s.rollNo}</td><td class="cell-strong">${s.name}</td><td class="muted">${s.email}</td>
        <td>${s.section ? html`<span class="badge badge-gray">${s.section.name} · ${s.section.sem}</span>` : '—'}</td>
        <td>${s.active ? html`<span class="badge badge-green">Active</span>` : html`<span class="badge badge-gray">Inactive</span>`}</td>
        <td class="right"><button type="button" class="btn btn-outline btn-sm" data-edit="${s.id}">Edit</button></td></tr>`)
        : html`<tr><td colspan="6">${emptyState('No students match.')}</td></tr>`}</tbody></table></div>`}
    ${pager(meta)}`);

  const reload = () => refresh();
  const search = view.querySelector('#q');
  search.addEventListener('input', debounce(e => { filters.q = e.target.value.trim(); filters.page = 1; filters.refocusSearch = true; reload(); }, 400));
  if (filters.refocusSearch) {
    // The page re-renders after a search; put the cursor back where the user was typing.
    requestAnimationFrame(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); });
    filters.refocusSearch = false;
  }
  view.querySelector('#sectionFilter').addEventListener('change', e => { filters.sectionId = e.target.value; filters.page = 1; reload(); });
  view.querySelector('#inactive').addEventListener('change', e => { filters.includeInactive = e.target.checked; filters.page = 1; reload(); });
  delegate(view, 'click', '[data-layout]', (e, b) => { filters.layout = b.dataset.layout; reload(); });
  delegate(view, 'click', '[data-page]', (e, b) => { filters.page = Number(b.dataset.page); reload(); });

  const sectionOptions = id => sections.map(s => html`<option value="${s._id}" ${id === s._id ? 'selected' : ''}>${s.name} · ${s.sem}</option>`);

  view.querySelector('#addStudent').addEventListener('click', () => {
    if (!sections.length) return toast('Create a section first.', 'error');
    openModal({
      title: 'Add student', confirmText: 'Add student',
      body: html`<form>
        <div class="field-row"><div class="field"><label for="sr">Roll number</label><input id="sr" name="rollNo" type="text" placeholder="CSE2026001" maxlength="40" autocomplete="off">
          <div class="field-hint">Letters, digits, "-" or "/". Case and spaces are ignored; must be unique.</div></div>
          <div class="field"><label for="sn">Full name</label><input id="sn" name="name" type="text" maxlength="120"></div></div>
        <div class="field"><label for="se">Email (sign-in)</label><input id="se" name="email" type="email" autocomplete="off"></div>
        <div class="field"><label for="sp">Temporary password</label><input id="sp" name="password" type="password" autocomplete="new-password"><div class="field-hint">The student must change it at first sign-in.</div></div>
        <div class="field-row"><div class="field"><label for="ss">Section</label><select id="ss" name="sectionId">${sectionOptions()}</select></div>
          <div class="field"><label for="sph">Phone <span class="faint">(optional)</span></label><input id="sph" name="phone" type="tel" maxlength="20"></div></div></form>`,
      async onConfirm(el, { showError }) {
        const missing = requireFields(el, ['rollNo', 'name', 'email', 'password', 'sectionId']); if (missing) { showError(missing); return false; }
        const v = readForm(el);
        await adminApi.createStudent({ rollNo: v.rollNo, name: v.name, email: v.email, password: v.password, sectionId: v.sectionId, phone: v.phone || undefined });
        toast('Student added.', 'success'); refresh();
      }
    });
  });

  delegate(view, 'click', '[data-edit]', (e, b) => {
    const s = rows.find(x => x.id === b.dataset.edit);
    openModal({
      title: `Edit ${s.name}`, confirmText: 'Save changes',
      body: html`<form>
        <div class="field-row"><div class="field"><label for="er">Roll number</label><input id="er" name="rollNo" type="text" value="${s.rollNo}" maxlength="40">
          <div class="field-hint">Changing a roll number is recorded in the audit log.</div></div>
          <div class="field"><label for="en">Full name</label><input id="en" name="name" type="text" value="${s.name}" maxlength="120"></div></div>
        <div class="field-row"><div class="field"><label for="es">Section</label><select id="es" name="sectionId">${sectionOptions(s.section && s.section._id)}</select></div>
          <div class="field"><label for="eph">Phone</label><input id="eph" name="phone" type="tel" value="${s.phone || ''}" maxlength="20"></div></div>
        <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active (can sign in and appears in class lists)</label>
        <div class="field"><label for="epw">Reset password <span class="faint">(optional)</span></label><input id="epw" name="password" type="password" autocomplete="new-password"></div>
        <p class="small muted">Deactivating keeps all attendance, duty leave and fee records.</p></form>`,
      async onConfirm(el, { showError }) {
        const missing = requireFields(el, ['rollNo', 'name', 'sectionId']); if (missing) { showError(missing); return false; }
        const v = readForm(el);
        await adminApi.updateStudent(s.id, {
          rollNo: v.rollNo, name: v.name, sectionId: v.sectionId, phone: v.phone, active: v.active, ...(v.password ? { password: v.password } : {})
        });
        toast('Student updated.', 'success'); refresh();
      }
    });
  });
}
