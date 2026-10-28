import { html, mount, delegate, debounce } from '../../utils/dom.js';
import { feeAdminApi, adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState, statusBadge, pager } from '../../components/ui.js';
import { openModal } from '../../components/modal.js';
import { readForm, requireFields } from '../../components/forms.js';
import { toast } from '../../components/toast.js';
import { formatMoney, parseRupees } from '../../utils/format.js';

const f = { sectionId: '', sessionId: '', semesterNumber: '', status: '', q: '', page: 1, refocus: false };

export default async function render({ view, refresh }) {
  const [sections, sessions, structures, summary] = await Promise.all([
    adminApi.sections(), adminApi.academicSessions(), feeAdminApi.structures(), feeAdminApi.summary()
  ]);
  const { rows, meta } = await feeAdminApi.assignments({
    sectionId: f.sectionId || undefined, sessionId: f.sessionId || undefined, semesterNumber: f.semesterNumber || undefined,
    status: f.status || undefined, q: f.q || undefined, page: f.page, limit: 25
  });

  mount(view, html`
    ${pageHeader('Fee Assignments', 'Assign a fee structure to a section, then track what each student owes.',
      html`<button type="button" class="btn btn-outline" id="exportOut">Export outstanding (CSV)</button>
           <button type="button" class="btn btn-primary" id="assignBtn">Assign fee structure</button>`)}
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total payable</div><div class="stat-value">${formatMoney(summary.payablePaise)}</div></div>
      <div class="stat-card"><div class="stat-label">Collected</div><div class="stat-value text-green">${formatMoney(summary.collectedPaise)}</div></div>
      <div class="stat-card"><div class="stat-label">Outstanding</div><div class="stat-value ${summary.outstandingPaise ? 'text-red' : ''}">${formatMoney(summary.outstandingPaise)}</div></div>
    </div>
    <div class="toolbar">
      <input type="search" id="fq" placeholder="Roll number" aria-label="Search by roll number" value="${f.q}" style="width:160px">
      <select id="fSection" aria-label="Section"><option value="">All sections</option>${sections.map(s => html`<option value="${s._id}" ${f.sectionId === s._id ? 'selected' : ''}>${s.name} · ${s.sem}</option>`)}</select>
      <select id="fSession" aria-label="Academic session"><option value="">All sessions</option>${sessions.map(s => html`<option value="${s._id}" ${f.sessionId === s._id ? 'selected' : ''}>${s.name}</option>`)}</select>
      <select id="fStatus" aria-label="Status"><option value="">Any status</option>${['unpaid', 'partial', 'paid'].map(v => html`<option value="${v}" ${f.status === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`)}</select>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Roll No</th><th>Student</th><th>Session</th><th>Sem</th><th class="right">Payable</th><th class="right">Paid</th><th class="right">Outstanding</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map(a => html`<tr>
        <td class="roll">${a.student?.rollNo}</td><td class="cell-strong">${a.student?.user?.name}</td><td>${a.academicSession?.name}</td><td>${a.semesterNumber}</td>
        <td class="right num">${formatMoney(a.totalPayablePaise)}</td><td class="right num">${formatMoney(a.paidPaise)}</td><td class="right num">${formatMoney(a.outstandingPaise)}</td>
        <td>${statusBadge(a.status)} ${a.overdue ? html`<span class="badge badge-red">Overdue</span>` : ''}</td>
        <td class="right"><button type="button" class="btn btn-outline btn-sm" data-adjust="${a._id}">Adjust</button></td></tr>`)
        : html`<tr><td colspan="9">${emptyState('No fee assignments match.')}</td></tr>`}</tbody></table></div>
    ${pager(meta)}`);

  const search = view.querySelector('#fq');
  search.addEventListener('input', debounce(e => { f.q = e.target.value.trim(); f.page = 1; f.refocus = true; refresh(); }, 400));
  if (f.refocus) { requestAnimationFrame(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }); f.refocus = false; }
  [['#fSection', 'sectionId'], ['#fSession', 'sessionId'], ['#fStatus', 'status']].forEach(([sel, key]) =>
    view.querySelector(sel).addEventListener('change', e => { f[key] = e.target.value; f.page = 1; refresh(); }));
  delegate(view, 'click', '[data-page]', (e, b) => { f.page = Number(b.dataset.page); refresh(); });
  view.querySelector('#exportOut').addEventListener('click', () => feeAdminApi.exportOutstanding({
    sectionId: f.sectionId || undefined, sessionId: f.sessionId || undefined
  }).catch(err => toast(err.message, 'error')));

  view.querySelector('#assignBtn').addEventListener('click', () => {
    if (!structures.length) return toast('Create a fee structure first.', 'error');
    openModal({
      title: 'Assign fee structure', confirmText: 'Assign',
      body: html`<form>
        <div class="field"><label for="as1">Fee structure</label><select id="as1" name="structureId">${structures.map(s =>
          html`<option value="${s._id}">${s.course}${s.specialization ? ` ${s.specialization}` : ''} · ${s.academicSession?.name} · Sem ${s.semesterNumber} · ${formatMoney(s.totalPaise)}</option>`)}</select></div>
        <div class="field"><label for="as2">Section</label><select id="as2" name="sectionId">${sections.map(s => html`<option value="${s._id}">${s.name} · ${s.sem} (${s.studentCount} students)</option>`)}</select>
          <div class="field-hint">Every active student in the section receives this fee. Students who already have a fee for that session and semester are skipped, never overwritten.</div></div></form>`,
      async onConfirm(el, { showError }) {
        const missing = requireFields(el, ['structureId', 'sectionId']); if (missing) { showError(missing); return false; }
        const r = await feeAdminApi.assign(readForm(el));
        toast(`Assigned to ${r.created} student(s)${r.skipped ? `, ${r.skipped} already had it` : ''}.`, 'success'); refresh();
      }
    });
  });

  delegate(view, 'click', '[data-adjust]', (e, b) => {
    const a = rows.find(x => x._id === b.dataset.adjust);
    openModal({
      title: `Adjust fee — ${a.student?.rollNo}`, confirmText: 'Apply',
      body: html`<form>
        <p class="small muted" style="margin-top:0">Currently payable ${formatMoney(a.totalPayablePaise)}, paid ${formatMoney(a.paidPaise)}. Adjustments are recorded permanently and cannot be deleted.</p>
        <div class="field"><label for="aj1">Type</label><select id="aj1" name="kind"><option value="concession">Concession / scholarship (reduces fee)</option><option value="charge">Additional charge (increases fee)</option></select></div>
        <div class="field"><label for="aj2">Description</label><input id="aj2" name="label" type="text" placeholder="e.g. Merit scholarship" maxlength="120"></div>
        <div class="field"><label for="aj3">Amount</label><div class="input-prefix"><span>₹</span><input id="aj3" name="amount" type="text" inputmode="decimal" placeholder="0.00"></div></div></form>`,
      async onConfirm(el, { showError }) {
        const missing = requireFields(el, ['label', 'amount']); if (missing) { showError(missing); return false; }
        const v = readForm(el); const paise = parseRupees(v.amount);
        if (!paise) { showError('Enter a valid amount.'); return false; }
        await feeAdminApi.adjust(a._id, { kind: v.kind, label: v.label, amountPaise: paise });
        toast('Fee adjusted.', 'success'); refresh();
      }
    });
  });
}
