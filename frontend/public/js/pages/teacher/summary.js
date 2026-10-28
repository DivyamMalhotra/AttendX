import { html, mount } from '../../utils/dom.js';
import { facultyApi } from '../../api/endpoints.js';
import { icons } from '../../components/icons.js';
import { progressBar, statusBadge, emptyState } from '../../components/ui.js';
import { formatPct } from '../../utils/format.js';

export default async function render({ view, params, ctx }) {
  const [rows, subjects] = await Promise.all([facultyApi.summary(params.subjectId), facultyApi.subjects()]);
  const subject = subjects.find(s => s.id === params.subjectId);
  const threshold = ctx.settings.attendanceThreshold;
  const short = rows.filter(r => r.belowThreshold).length;

  mount(view, html`
    <a href="#classes" class="back-link">${icons.back} Back</a>
    <div class="page-header"><h1>${subject ? subject.name : 'Subject'} — attendance summary</h1>
      <div class="sub">${subject ? `${subject.section.name} · ${subject.section.sem} · ` : ''}${short} of ${rows.length} students below ${threshold}%</div></div>
    ${rows.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Roll No</th><th>Name</th><th class="right">Attended</th><th class="right">Eligible</th><th class="right">Duty leave</th><th>Attendance</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => html`<tr>
        <td class="roll">${r.student.rollNo}</td><td class="cell-strong">${r.student.name}</td>
        <td class="right num">${r.attended}</td><td class="right num">${r.eligible}</td><td class="right num">${r.exempt}</td>
        <td>${progressBar(r.percentage, threshold)}</td><td>${statusBadge(r.status)}</td></tr>`)}</tbody></table></div>`
      : html`<div class="card">${emptyState('No students are enrolled in this section yet.')}</div>`}
    <p class="small muted mt-16">Percentages follow the college policy for approved duty leave. Overall: ${formatPct(rows.length ? rows.reduce((t, r) => t + (r.percentage || 0), 0) / rows.length : null)} average.</p>
  `);
}
