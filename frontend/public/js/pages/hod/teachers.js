import { html, mount, delegate } from '../../utils/dom.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { readForm, requireFields } from '../../components/forms.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { initials } from '../../utils/format.js';

const passwordField = (label, hint = 'At least 8 characters, with letters and a number.') => html`
  <div class="field"><label for="tpw">${label}</label><input id="tpw" name="password" type="password" autocomplete="new-password"><div class="field-hint">${hint}</div></div>`;

export default async function render({ view, refresh }) {
  const [teachers, sections] = await Promise.all([adminApi.teachers(), adminApi.sections()]);

  mount(view, html`
    ${pageHeader('Teachers', `${teachers.length} faculty member${teachers.length === 1 ? '' : 's'}`,
      html`<button type="button" class="btn btn-primary" id="addTeacher">${icons.plus} Add Teacher</button>`)}
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Assigned to</th><th></th></tr></thead>
      <tbody>${teachers.length ? teachers.map(t => html`<tr class="${t.active ? '' : 'faint'}">
        <td><div class="flex-center gap-10"><div class="avatar" style="width:28px;height:28px;font-size:11px">${initials(t.name)}</div>
          <span class="cell-strong">${t.name}</span>${t.active ? '' : html`<span class="badge badge-gray">Inactive</span>`}</div></td>
        <td class="muted">${t.email}</td>
        <td><div class="flex-center gap-8 wrap">
          ${t.subjects.map(s => html`<span class="badge badge-blue">${s.section ? `${s.section.name} — ` : ''}${s.name}
            <span class="badge-btn" role="button" tabindex="0" data-unassign="${s.id}" title="Unassign from this teacher" aria-label="Unassign ${s.name}">✕</span></span>`)}
          <span class="badge badge-gray badge-btn" role="button" tabindex="0" data-assign="${t.id}">+ Assign</span></div></td>
        <td class="right"><button type="button" class="btn btn-outline btn-sm" data-edit="${t.id}">Manage</button></td></tr>`)
        : html`<tr><td colspan="4">${emptyState('No teachers yet.')}</td></tr>`}</tbody></table></div>`);

  const run = async (fn, msg) => { try { await fn(); toast(msg, 'success'); refresh(); } catch (err) { toast(err.message, 'error'); } };

  view.querySelector('#addTeacher').addEventListener('click', () => openModal({
    title: 'Add teacher', confirmText: 'Add teacher',
    body: html`<form>
      <div class="field"><label for="tn">Full name</label><input id="tn" name="name" type="text" placeholder="Dr. Jane Doe" maxlength="120"></div>
      <div class="field"><label for="te">Email</label><input id="te" name="email" type="email" placeholder="j.doe@college.edu" autocomplete="off"></div>
      ${passwordField('Temporary password', 'They must change this at first sign-in. At least 8 characters, letters and a number.')}</form>`,
    async onConfirm(el, { showError }) {
      const missing = requireFields(el, ['name', 'email', 'password']); if (missing) { showError(missing); return false; }
      await adminApi.createTeacher(readForm(el)); toast('Teacher added.', 'success'); refresh();
    }
  }));

  delegate(view, 'click', '[data-edit]', (e, b) => {
    const t = teachers.find(x => x.id === b.dataset.edit);
    openModal({
      title: `Manage ${t.name}`, confirmText: 'Save changes',
      body: html`<form>
        <div class="field"><label for="en">Full name</label><input id="en" name="name" type="text" value="${t.name}" maxlength="120"></div>
        <label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Account active (can sign in)</label>
        ${passwordField('Reset password (optional)', 'Leave blank to keep the current password. A new one must be changed at next sign-in.')}</form>`,
      async onConfirm(el) {
        const v = readForm(el);
        await adminApi.updateTeacher(t.id, { name: v.name, active: v.active, ...(v.password ? { password: v.password } : {}) });
        toast('Teacher updated.', 'success'); refresh();
      }
    });
  });

  delegate(view, 'click', '[data-unassign]', async (e, b) => {
    if (await confirmDialog({ title: 'Unassign subject', message: 'Remove this teacher from the subject? The subject and its attendance history are kept.', confirmText: 'Unassign' })) {
      run(() => adminApi.updateSubject(b.dataset.unassign, { teacherId: null }), 'Unassigned.');
    }
  });

  delegate(view, 'click', '[data-assign]', (e, b) => {
    const teacherId = b.dataset.assign;
    openModal({
      title: 'Assign subject', confirmText: 'Assign',
      body: html`<form>
        <div class="field"><label for="as">Section</label><select id="as" name="sectionId">${sections.map(s => html`<option value="${s._id}">${s.name} · ${s.sem}</option>`)}</select></div>
        <div class="field"><label for="an">Subject name</label><input id="an" name="name" type="text" placeholder="e.g. Algorithms" maxlength="100">
          <div class="field-hint">Creates the subject in that section and assigns it to this teacher.</div></div>
        <div class="field"><label for="ac">Subject code <span class="faint">(optional)</span></label><input id="ac" name="code" type="text" maxlength="20"></div></form>`,
      async onConfirm(el, { showError }) {
        const missing = requireFields(el, ['sectionId', 'name']); if (missing) { showError(missing); return false; }
        const v = readForm(el);
        await adminApi.createSubject(v.sectionId, { name: v.name, code: v.code || undefined, teacherId });
        toast('Subject assigned.', 'success'); refresh();
      }
    });
  });
}
