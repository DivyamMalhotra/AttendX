import { html, mount, delegate } from '../../utils/dom.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader, emptyState, progressBar, statusBadge, pager } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { formatDate } from '../../utils/format.js';

const state = { tab: 'report', sectionId: '', subjectId: '', below: true, page: 1 };

export default async function render({ view, ctx, refresh }) {
  const threshold = ctx.settings.attendanceThreshold;
  const sections = await adminApi.sections();
  const subjects = sections.flatMap(s => s.subjects.map(sub => ({ ...sub, sectionId: s._id, label: `${s.name} — ${sub.name}` })))
    .filter(s => !state.sectionId || s.sectionId === state.sectionId);

  const tabs = '';

  let body;
  if (state.tab === 'alerts') {
    const { rows, meta } = await adminApi.alerts({ page: state.page, limit: 25 });
    body = html`<div class="table-wrap"><table>
      <thead><tr><th>Roll No</th><th>Student</th><th>Section</th><th>Subject</th><th>Attendance</th><th>Since</th></tr></thead>
      <tbody>${rows.length ? rows.map(a => html`<tr>
        <td class="roll">${a.student?.rollNo}</td><td class="cell-strong">${a.student?.user?.name}</td>
        <td>${a.student?.section ? `${a.student.section.name} · ${a.student.section.sem}` : ''}</td><td>${a.subject?.name}</td>
        <td>${progressBar(a.percentage, a.threshold)}<div class="small faint">${a.attended}/${a.eligible} classes</div></td><td class="small muted">${formatDate(a.openedAt)}</td></tr>`)
        : html`<tr><td colspan="6">${emptyState('No students are below the attendance threshold.')}</td></tr>`}</tbody></table></div>${pager(meta)}`;
  } else {
    const rows = await adminApi.attendanceReport({ sectionId: state.sectionId || undefined, subjectId: state.subjectId || undefined, belowThreshold: state.below ? 'true' : undefined });
    const shown = rows.slice((state.page - 1) * 50, state.page * 50);
    body = html`<div class="toolbar">
        <select id="repSection" aria-label="Section"><option value="">All sections</option>${sections.map(s => html`<option value="${s._id}" ${state.sectionId === s._id ? 'selected' : ''}>${s.name} · ${s.sem}</option>`)}</select>
        <select id="repSubject" aria-label="Subject"><option value="">All subjects</option>${subjects.map(s => html`<option value="${s._id}" ${state.subjectId === s._id ? 'selected' : ''}>${s.label}</option>`)}</select>
        <label class="check" style="margin:0"><input type="checkbox" id="repBelow" ${state.below ? 'checked' : ''}> Only below ${threshold}%</label>
        <button type="button" class="btn btn-outline" id="repCsv">Export CSV</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Roll No</th><th>Student</th><th>Subject</th><th class="right">Attended</th><th class="right">Eligible</th><th class="right">Duty leave</th><th>Attendance</th><th>Status</th></tr></thead>
        <tbody>${shown.length ? shown.map(r => html`<tr><td class="roll">${r.rollNo}</td><td class="cell-strong">${r.name}</td><td>${r.subject}</td>
          <td class="right num">${r.attended}</td><td class="right num">${r.eligible}</td><td class="right num">${r.exempt}</td>
          <td>${progressBar(r.percentage, threshold)}</td><td>${statusBadge(r.status)}</td></tr>`)
          : html`<tr><td colspan="8">${emptyState('Nothing to show for these filters.')}</td></tr>`}</tbody></table></div>
      ${pager({ total: rows.length, page: state.page, limit: 50, pages: Math.ceil(rows.length / 50) })}`;
  }

  mount(view, html`
    ${pageHeader('Attendance reports', `Required attendance: ${threshold}% per subject. Shortage alerts and at-risk lists are handled by each student's mentor (Teacher → Attendance watch).`)}
    ${tabs}${body}`);

  delegate(view, 'click', '[data-tab]', (e, b) => { state.tab = b.dataset.tab; state.page = 1; refresh(); });
  delegate(view, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); refresh(); });
  view.querySelector('#repSection')?.addEventListener('change', e => { state.sectionId = e.target.value; state.subjectId = ''; state.page = 1; refresh(); });
  view.querySelector('#repSubject')?.addEventListener('change', e => { state.subjectId = e.target.value; state.page = 1; refresh(); });
  view.querySelector('#repBelow')?.addEventListener('change', e => { state.below = e.target.checked; state.page = 1; refresh(); });
  view.querySelector('#repCsv')?.addEventListener('click', () => adminApi.exportAttendance({
    sectionId: state.sectionId || undefined, subjectId: state.subjectId || undefined, belowThreshold: state.below ? 'true' : undefined
  }).catch(err => toast(err.message, 'error')));
}
