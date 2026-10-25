import { html, mount, delegate } from '../../utils/dom.js';
import { examsApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { dataTable, statusPill, act, confirmThen, formModal } from '../../components/kit.js';
import { toast } from '../../components/toast.js';
import { formatDate } from '../../utils/format.js';

export default async function render({ view, params, refresh }) {
  if (params.id) return sheet(view, params.id, refresh);
  const exams = await examsApi.facultyList();
  mount(view, html`${pageHeader('Examinations', 'Enter marks for your exams, then submit them for review.')}
    ${exams.length ? dataTable([
      { label: 'Exam', render: e => html`<span class="cell-strong">${e.name}</span><div class="small muted">${e.subject ? e.subject.name : ''} · ${e.section ? e.section.name : ''}</div>` },
      { label: 'Date', render: e => formatDate(e.date) }, { label: 'Max', cls: 'right', render: e => e.maxMarks }, { label: 'Status', render: e => statusPill(e.status) },
      { label: '', cls: 'right', render: e => html`<a class="btn btn-outline btn-sm" href="#exam/${e._id}">${['draft', 'marks_entry'].includes(e.status) ? 'Enter marks' : 'View'}</a>` }
    ], exams) : html`<div class="card">${emptyState('No examinations are assigned to you.')}</div>`}`);
}

async function sheet(view, id, refresh) {
  const s = await examsApi.facultySheet(id);
  mount(view, html`<a class="back-link" href="#exams">&larr; Examinations</a>
    ${pageHeader(`${s.exam.name} — ${s.exam.subject}`, `Maximum ${s.exam.maxMarks} · pass ${s.exam.passMarks} · ${s.exam.status.replace('_', ' ')}`)}
    ${s.exam.revision > 1 && s.editable ? html`<div class="notice notice-warning"><div>This exam was reopened. Give a reason when you save corrected marks.</div></div>` : ''}
    <form id="marks"><div class="table-wrap"><table><thead><tr><th>Roll no</th><th>Name</th><th>Marks</th><th>Absent</th></tr></thead>
      <tbody>${s.students.map(st => html`<tr data-id="${st.id}"><td class="roll">${st.rollNo}</td><td>${st.name}</td>
        <td><input type="number" step="0.5" min="0" max="${s.exam.maxMarks}" value="${st.marks ?? ''}" ${s.editable ? '' : 'disabled'} style="width:100px" aria-label="Marks for ${st.name}"></td>
        <td><input type="checkbox" ${st.absent ? 'checked' : ''} ${s.editable ? '' : 'disabled'} aria-label="${st.name} absent"></td></tr>`)}</tbody></table></div>
      ${s.editable ? html`<div class="flex gap-8 mt-12"><button class="btn btn-primary" type="submit">Save marks</button><button class="btn btn-outline" type="button" id="submitReview">Submit for review</button></div>` : ''}</form>`);
  const collect = () => [...view.querySelectorAll('tbody tr')].map(tr => {
    const [m, a] = tr.querySelectorAll('input');
    return { studentId: tr.dataset.id, absent: a.checked, marks: a.checked || m.value === '' ? null : Number(m.value) };
  });
  const save = async reason => examsApi.saveMarks(id, { entries: collect(), ...(reason ? { reason } : {}) });
  view.querySelector('#marks')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (s.exam.revision > 1) return formModal({ title: 'Reason for correction', fields: [{ name: 'reason', label: 'Reason', required: true }], onSubmit: async v => { await save(v.reason); toast('Marks saved.', 'success'); refresh(); } });
    act(() => save(), { success: 'Marks saved.', after: refresh });
  });
  view.querySelector('#submitReview')?.addEventListener('click', () => confirmThen({
    title: 'Submit for review', message: 'Marks are saved and locked for editing until the examination cell returns them.', confirmText: 'Submit',
    run: async () => { await save(s.exam.revision > 1 ? 'Resubmitted' : undefined); await examsApi.submit(id); }, success: 'Submitted for review.', after: refresh
  }));
}
