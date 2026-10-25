import { html, mount, delegate, $, $$ } from '../../utils/dom.js';
import { feeAdminApi, adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState, notice } from '../../components/ui.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { icons } from '../../components/icons.js';
import { formatMoney, formatDate, parseRupees } from '../../utils/format.js';

const KINDS = [['tuition', 'Tuition'], ['examination', 'Examination'], ['registration', 'Registration'], ['other', 'Other']];

const componentRow = (c = {}) => html`<div class="field-row comp-row" style="align-items:flex-end;margin-bottom:8px">
  <div class="field" style="margin:0;flex:2"><label class="sr-only">Name</label><input type="text" data-f="name" placeholder="Fee name" value="${c.name || ''}" maxlength="80"></div>
  <div class="field" style="margin:0"><label class="sr-only">Type</label><select data-f="kind">${KINDS.map(([v, l]) => html`<option value="${v}" ${c.kind === v ? 'selected' : ''}>${l}</option>`)}</select></div>
  <div class="field" style="margin:0"><label class="sr-only">Amount in rupees</label><div class="input-prefix"><span>₹</span><input type="text" data-f="amount" inputmode="decimal" placeholder="0.00" value="${c.amountPaise ? (c.amountPaise / 100).toFixed(2) : ''}"></div></div>
  <button type="button" class="btn-icon" data-remove-row aria-label="Remove fee line">${icons.x}</button></div>`;

/** Reads component rows from the dialog; returns { components } or { error }. */
function readComponents(el) {
  const rows = $$('.comp-row', el);
  const components = [];
  for (const r of rows) {
    const name = $('[data-f=name]', r).value.trim();
    const amount = $('[data-f=amount]', r).value.trim();
    if (!name && !amount) continue;
    const amountPaise = parseRupees(amount);
    if (!name || amountPaise === null || amountPaise <= 0) return { error: 'Every fee line needs a name and an amount greater than zero.' };
    components.push({ name, kind: $('[data-f=kind]', r).value, amountPaise });
  }
  return components.length ? { components } : { error: 'Add at least one fee line.' };
}

function wireRows(el) {
  const list = $('#compList', el);
  const total = () => {
    const r = readComponents(el);
    $('#compTotal', el).textContent = r.components ? formatMoney(r.components.reduce((t, c) => t + c.amountPaise, 0)) : '—';
  };
  $('#addRow', el).addEventListener('click', () => { list.insertAdjacentHTML('beforeend', componentRow().toString()); });
  delegate(list, 'click', '[data-remove-row]', (e, b) => { b.closest('.comp-row').remove(); total(); });
  list.addEventListener('input', total);
  total();
}

export default async function render({ view, refresh }) {
  const [structures, sessions] = await Promise.all([feeAdminApi.structures(), adminApi.academicSessions()]);

  mount(view, html`
    ${pageHeader('Fee Structures', 'Define what each course, session and semester costs. Editing a structure never changes fees already assigned to students.',
      html`<button type="button" class="btn btn-primary" id="newStructure">${icons.plus} New fee structure</button>`)}
    ${!sessions.length ? notice('warning', 'No academic session yet', html`Create one in <a class="btn-link" href="#settings">Settings</a> before adding fee structures.`) : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>Course</th><th>Session</th><th>Semester</th><th class="right">Total</th><th>Due</th><th class="right">Assigned</th><th></th></tr></thead>
      <tbody>${structures.length ? structures.map(s => html`<tr>
        <td><div class="cell-strong">${s.course}</div><div class="small muted">${s.specialization || '—'}</div></td>
        <td>${s.academicSession?.name || ''}${s.academicSession?.isCurrent ? html` <span class="badge badge-blue">Current</span>` : ''}</td>
        <td>Semester ${s.semesterNumber}</td><td class="right num">${formatMoney(s.totalPaise)}</td>
        <td>${s.dueDate ? formatDate(s.dueDate) : '—'}</td><td class="right num">${s.assignedCount}</td>
        <td class="right"><button type="button" class="btn btn-outline btn-sm" data-edit="${s._id}">Edit</button>
          <button type="button" class="btn btn-ghost btn-sm" data-del="${s._id}" ${s.assignedCount ? 'disabled title="Already assigned to students"' : ''}>Delete</button></td></tr>`)
        : html`<tr><td colspan="7">${emptyState('No fee structures yet.')}</td></tr>`}</tbody></table></div>`);

  const compSection = (components = [{}]) => html`<div id="compList">${components.map(componentRow)}</div>
    <button type="button" class="btn btn-outline btn-sm" id="addRow">${icons.plus} Add fee line</button>
    <div class="flex-between mt-16"><b>Total semester fee</b><b id="compTotal" class="num">—</b></div>`;

  $('#newStructure', view).addEventListener('click', () => {
    if (!sessions.length) return toast('Create an academic session first (Settings).', 'error');
    openModal({
      title: 'New fee structure', wide: true, confirmText: 'Create structure',
      body: html`<form>
        <div class="field-row">
          <div class="field"><label for="fc">Course</label><input id="fc" name="course" type="text" placeholder="B.Tech" maxlength="80"></div>
          <div class="field"><label for="fs">Specialization</label><input id="fs" name="specialization" type="text" placeholder="CSE" maxlength="80"></div></div>
        <div class="field-row">
          <div class="field"><label for="fa">Academic session</label><select id="fa" name="academicSessionId">${sessions.map(s => html`<option value="${s._id}" ${s.isCurrent ? 'selected' : ''}>${s.name}</option>`)}</select></div>
          <div class="field"><label for="fn">Semester</label><input id="fn" name="semesterNumber" type="number" min="1" max="12" value="1"></div>
          <div class="field"><label for="fd">Due date</label><input id="fd" name="dueDate" type="date"></div></div>
        <h4 class="card-section-label">Fee lines</h4>${compSection([{ name: 'Tuition fee', kind: 'tuition' }, { name: 'Examination fee', kind: 'examination' }, { name: 'Registration fee', kind: 'registration' }])}</form>`,
      onOpen: el => wireRows(el),
      async onConfirm(el, { showError }) {
        const r = readComponents(el); if (r.error) { showError(r.error); return false; }
        const get = n => $(`[name=${n}]`, el).value.trim();
        if (!get('course')) { showError('Enter the course.'); return false; }
        await feeAdminApi.createStructure({
          course: get('course'), specialization: get('specialization') || undefined, academicSessionId: get('academicSessionId'),
          semesterNumber: Number(get('semesterNumber')), dueDate: get('dueDate') || null, components: r.components
        });
        toast('Fee structure created.', 'success'); refresh();
      }
    });
  });

  delegate(view, 'click', '[data-edit]', (e, b) => {
    const s = structures.find(x => x._id === b.dataset.edit);
    openModal({
      title: `Edit ${s.course} Sem ${s.semesterNumber}`, wide: true, confirmText: 'Save changes',
      body: html`<form>${notice('info', '', `${s.assignedCount} student(s) already hold this fee. They keep the amounts they were assigned; changes apply to future assignments only.`)}
        <div class="field"><label for="ed">Due date</label><input id="ed" name="dueDate" type="date" value="${s.dueDate || ''}"></div>
        <h4 class="card-section-label">Fee lines</h4>${compSection(s.components)}</form>`,
      onOpen: el => wireRows(el),
      async onConfirm(el, { showError }) {
        const r = readComponents(el); if (r.error) { showError(r.error); return false; }
        await feeAdminApi.updateStructure(s._id, { components: r.components, dueDate: $('[name=dueDate]', el).value || null });
        toast('Fee structure updated.', 'success'); refresh();
      }
    });
  });

  delegate(view, 'click', '[data-del]:not([disabled])', async (e, b) => {
    if (!await confirmDialog({ title: 'Delete fee structure', message: 'Delete this unassigned fee structure?', confirmText: 'Delete', danger: true })) return;
    try { await feeAdminApi.deleteStructure(b.dataset.del); toast('Deleted.', 'success'); refresh(); } catch (err) { toast(err.message, 'error'); }
  });
}
