import { html, mount, delegate } from '../../utils/dom.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { readForm, requireFields } from '../../components/forms.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';

const sectionForm = (s = {}) => html`<form>
  <div class="field-row">
    <div class="field"><label for="sn">Section name</label><input id="sn" name="name" type="text" value="${s.name || ''}" placeholder="e.g. CS-C" maxlength="40"></div>
    <div class="field"><label for="ss">Semester no.</label><input id="ss" name="semesterNumber" type="number" min="1" max="12" value="${s.semesterNumber || ''}" placeholder="3"></div>
  </div>
  <div class="field-row">
    <div class="field"><label for="sc">Course</label><input id="sc" name="course" type="text" value="${s.course || ''}" placeholder="B.Tech" maxlength="80"></div>
    <div class="field"><label for="sp">Specialization</label><input id="sp" name="specialization" type="text" value="${s.specialization || ''}" placeholder="CSE" maxlength="80"></div>
  </div>
  <div class="field-hint">Course and specialization are used to match fee structures to students.</div></form>`;

const sectionBody = el => {
  const v = readForm(el);
  return { name: v.name, semesterNumber: Number(v.semesterNumber), course: v.course || undefined, specialization: v.specialization || undefined };
};

// Expanded panels survive refreshes (module scope), not page reloads.
const open = new Set();

export default async function render({ view, refresh }) {
  const [sections, teachers] = await Promise.all([adminApi.sections(), adminApi.teachers()]);
  const activeTeachers = teachers.filter(t => t.active);

  const teacherOptions = selected => html`<option value="">Unassigned</option>${activeTeachers.map(t => html`<option value="${t.id}" ${selected === t.id ? 'selected' : ''}>${t.name}</option>`)}`;

  function paint() {
    mount(view, html`
      ${pageHeader('Sections', `${sections.length} section${sections.length === 1 ? '' : 's'}`,
        html`<button type="button" class="btn btn-primary" id="newSection">${icons.plus} New Section</button>`)}
      ${sections.length ? sections.map(s => html`<div class="card" style="margin-bottom:14px">
        <div class="section-row-head">
          <div class="flex-center gap-12"><div class="class-icon">${icons.grid}</div>
            <div><div class="strong">${s.name} · ${s.sem}</div>
              <div class="small muted">${s.studentCount} students · ${s.subjects.length} subjects · Mentor: ${s.mentor ? s.mentor.name : 'Not set'}${s.course ? ` · ${s.course}${s.specialization ? ` ${s.specialization}` : ''}` : ''}</div></div></div>
          <div class="flex gap-8">
            <button type="button" class="btn btn-outline btn-sm" data-edit="${s._id}">Edit</button>
            <button type="button" class="btn btn-outline btn-sm" data-del="${s._id}" ${s.studentCount ? 'disabled title="Cannot delete: section has students"' : ''}>Delete</button>
            <button type="button" class="btn-icon" data-toggle="${s._id}" aria-expanded="${open.has(s._id)}" aria-label="Show subjects"><span class="chev ${open.has(s._id) ? 'open' : ''}">${icons.chevron}</span></button>
          </div>
        </div>
        ${open.has(s._id) ? html`<div class="subject-panel">
          <div class="flex-center gap-10 wrap" style="padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--border)">
            <label class="small strong muted" for="mentor_${s._id}">Mentor (reviews this section's duty leave):</label>
            <select id="mentor_${s._id}" style="max-width:220px;padding:7px 10px;border:1px solid var(--border);border-radius:7px">
              <option value="">Not set</option>${activeTeachers.map(t => html`<option value="${t.id}" ${s.mentor && String(s.mentor._id) === t.id ? 'selected' : ''}>${t.name}</option>`)}</select>
            <button type="button" class="btn-link" data-mentor="${s._id}">Save</button></div>
          ${s.subjects.length ? s.subjects.map(sub => html`<div class="subject-row">
            <span><span class="strong">${sub.name}</span> ${sub.code ? html`<span class="faint">· ${sub.code}</span>` : ''}</span>
            <span class="flex-center gap-8">
              <select data-reassign="${sub._id}" aria-label="Teacher for ${sub.name}" style="padding:5px 8px;border:1px solid var(--border);border-radius:7px">${teacherOptions(sub.teacher ? String(sub.teacher._id) : '')}</select>
              <button type="button" class="btn-link danger" data-rmsub="${sub._id}">Remove</button></span></div>`)
            : html`<div class="faint small">No subjects added yet.</div>`}
          <div class="add-subject-form">
            <input type="text" placeholder="Subject name" id="subName_${s._id}" aria-label="Subject name" maxlength="100">
            <input type="text" placeholder="Code (optional)" id="subCode_${s._id}" aria-label="Subject code" maxlength="20" style="width:130px">
            <select id="subTeacher_${s._id}" aria-label="Teacher">${teacherOptions('')}</select>
            <button type="button" class="btn btn-outline btn-sm" data-addsub="${s._id}">+ Add Subject</button></div>
        </div>` : ''}
      </div>`) : html`<div class="card">${emptyState('No sections yet. Create your first one.')}</div>`}`);
  }
  paint();

  view.addEventListener('click', e => { if (e.target.closest('#newSection')) createSection(); });
  const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'success'); refresh(); } catch (err) { toast(err.message, 'error'); } };

  function createSection() {
    openModal({ title: 'New section', body: sectionForm(), confirmText: 'Create', async onConfirm(el, { showError }) {
      const missing = requireFields(el, ['name', 'semesterNumber']); if (missing) { showError(missing); return false; }
      await adminApi.createSection(sectionBody(el)); toast('Section created.', 'success'); refresh();
    } });
  }
  delegate(view, 'click', '[data-edit]', (e, b) => {
    const s = sections.find(x => x._id === b.dataset.edit);
    openModal({ title: 'Edit section', body: sectionForm(s), confirmText: 'Save', async onConfirm(el, { showError }) {
      const missing = requireFields(el, ['name', 'semesterNumber']); if (missing) { showError(missing); return false; }
      await adminApi.updateSection(s._id, sectionBody(el)); toast('Section updated.', 'success'); refresh();
    } });
  });
  delegate(view, 'click', '[data-del]:not([disabled])', async (e, b) => {
    if (await confirmDialog({ title: 'Delete section', message: 'Delete this section and its subjects? This cannot be undone.', confirmText: 'Delete', danger: true })) {
      run(() => adminApi.deleteSection(b.dataset.del), 'Section deleted.');
    }
  });
  delegate(view, 'click', '[data-toggle]', (e, b) => { const id = b.dataset.toggle; open.has(id) ? open.delete(id) : open.add(id); paint(); });
  delegate(view, 'click', '[data-mentor]', (e, b) => run(() => adminApi.setMentor(b.dataset.mentor, view.querySelector(`#mentor_${b.dataset.mentor}`).value || null), 'Mentor updated.'));
  delegate(view, 'change', '[data-reassign]', (e, sel) => run(() => adminApi.updateSubject(sel.dataset.reassign, { teacherId: sel.value || null }), 'Teacher updated.'));
  delegate(view, 'click', '[data-rmsub]', async (e, b) => {
    if (await confirmDialog({ title: 'Remove subject', message: 'Remove this subject? Subjects with attendance history cannot be removed.', confirmText: 'Remove', danger: true })) {
      run(() => adminApi.deleteSubject(b.dataset.rmsub), 'Subject removed.');
    }
  });
  delegate(view, 'click', '[data-addsub]', (e, b) => {
    const id = b.dataset.addsub;
    const name = view.querySelector(`#subName_${id}`).value.trim();
    if (!name) return toast('Enter a subject name.', 'error');
    run(() => adminApi.createSubject(id, {
      name, code: view.querySelector(`#subCode_${id}`).value.trim() || undefined, teacherId: view.querySelector(`#subTeacher_${id}`).value || null
    }), 'Subject added.');
  });
}
