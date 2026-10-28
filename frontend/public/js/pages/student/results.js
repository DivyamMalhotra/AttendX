import { html, mount, delegate } from '../../utils/dom.js';
import { examsApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { badge, dataTable, act } from '../../components/kit.js';
import { formatDate } from '../../utils/format.js';

/** Academic record: a period selector, the chosen period's subjects with its GPA, and the history of every published period. */
export default async function render({ view, ctx, refresh }) {
  const r = await examsApi.myResults();
  ctx.live.on('notification', refresh);
  const key = s => `${s.session.id}:${s.semesterNumber}`;
  let selected = r.semesters.length ? key(r.semesters[r.semesters.length - 1]) : null;

  function paint() {
    const s = r.semesters.find(x => key(x) === selected);
    mount(view, html`
      ${pageHeader('Results', 'Only results published by the examination cell appear here. Pending papers are not shown until published.')}
      ${s ? html`
        <div class="stmt" style="grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr)">
          <div>
            <div class="toolbar"><select id="period" aria-label="Academic period">${r.semesters.map(x => html`<option value="${key(x)}" ${key(x) === selected ? 'selected' : ''}>${x.session.name} · Semester ${x.semesterNumber}</option>`)}</select>
              ${ctx.user.role === 'student' ? html`<button type="button" class="btn btn-outline btn-sm" data-card="${selected}">Report card (PDF)</button>` : ''}</div>
            ${dataTable([
              { label: 'Subject', render: e => html`<span class="cell-strong">${e.subject}</span> <span class="faint small">${e.subjectCode || ''}</span>` },
              { label: 'Exam', render: e => `${e.exam} · ${formatDate(e.date)}` },
              { label: 'Marks', cls: 'right', render: e => (e.state === 'absent' ? 'Absent' : `${e.marks}/${e.maxMarks}`) },
              { label: 'Grade', render: e => badge(e.passed ? 'green' : 'red', e.grade) }
            ], s.exams)}
          </div>
          <div class="stmt-balance">
            <div class="lbl">Semester GPA</div><div class="amt ${s.status === 'FAIL' ? 'due' : 'clear'}">${s.gpa ?? '—'}</div>
            <div class="muted small">${s.status ? `Result: ${s.status}` : 'No GPA subjects yet'} · ${s.credits} credits</div>
            <div class="mt-16"><div class="lbl">Cumulative GPA</div><div class="display" style="font-size:32px">${r.cgpa ?? '—'}</div></div>
          </div>
        </div>
        <section><div class="sec-head"><h2>History</h2></div>
          <div class="rows">${[...r.semesters].reverse().map(x => html`<div class="row-item"><div><div class="title">${x.session.name} · Semester ${x.semesterNumber}</div><div class="meta">${x.subjects.length} subjects · ${x.credits} credits</div></div>
            <div class="flex gap-12"><b class="num">GPA ${x.gpa ?? '—'}</b>${x.status ? badge(x.status === 'PASS' ? 'green' : 'red', x.status) : ''}<button type="button" class="btn-link" data-open="${key(x)}">View</button></div></div>`)}</div></section>`
        : html`<div class="card">${emptyState('No results have been published yet.')}</div>`}`);
  }
  paint();

  view.addEventListener('change', e => { if (e.target.id === 'period') { selected = e.target.value; paint(); } });
  delegate(view, 'click', '[data-open]', (e, b) => { selected = b.dataset.open; paint(); window.scrollTo(0, 0); });
  delegate(view, 'click', '[data-card]', (e, b) => {
    const [sessionId, semesterNumber] = b.dataset.card.split(':');
    act(() => examsApi.myReportCard({ sessionId, semesterNumber }));
  });
}
