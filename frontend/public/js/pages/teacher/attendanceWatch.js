import { html, mount } from '../../utils/dom.js';
import { mentorApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, badge } from '../../components/kit.js';

/** Attendance alerts and at-risk students for the teacher's own mentees (the server restricts the data to them). */
export default async function render({ view }) {
  const { atRisk, alerts } = await mentorApi.attendanceWatch();
  mount(view, html`
    ${pageHeader('Attendance watch', `Students you mentor · ${atRisk.total} at risk · ${alerts.length} open shortage alert${alerts.length === 1 ? '' : 's'}`)}
    <h2 class="h3">At-risk students</h2>
    ${dataTable([
      { label: 'Roll no', render: r => r.rollNo },
      { label: 'Student', render: r => html`<span class="cell-strong">${r.name}</span><div class="small muted">${r.section || ''}</div>` },
      { label: 'Attendance', cls: 'right', render: r => (r.attendance === null ? '—' : `${r.attendance}%`) },
      { label: 'Why', render: r => html`<div class="flex gap-8 wrap">${r.flags.map(f => badge('red', f.detail))}</div>` }
    ], atRisk.rows, { empty: 'None of your mentees is below the attendance threshold.' })}
    <h2 class="h3 mt-16">Shortage alerts</h2>
    ${dataTable([
      { label: 'Roll no', render: a => a.rollNo }, { label: 'Student', render: a => a.name },
      { label: 'Subject', render: a => a.subject }, { label: 'Attendance', cls: 'right', render: a => `${a.percentage ?? '—'}% (needs ${a.threshold}%)` }
    ], alerts, { empty: 'No open alerts.' })}`);
}
