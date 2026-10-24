import { html, mount } from '../../utils/dom.js';
import { parentApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { card, dataTable, statCards, badge } from '../../components/kit.js';
import { mountTimeline } from '../../components/timeline.js';
import { formatMoney, formatDate } from '../../utils/format.js';

export default async function render({ view, params }) {
  const s = await parentApi.view(params.id, 'summary');
  const name = s.student.name;
  mount(view, html`
    <a class="back-link" href="#children">&larr; All children</a>
    ${pageHeader(name, `${s.student.rollNo}${s.student.section ? ` · ${s.student.section.name}` : ''}`)}
    ${statCards([
      ...(s.attendance ? [{ label: 'Overall attendance', value: s.attendance.overall && s.attendance.overall.percentage !== null ? `${s.attendance.overall.percentage}%` : '—', hint: `Required ${s.attendance.threshold}%` }] : []),
      ...(s.fees ? [{ label: 'Fees outstanding', value: formatMoney(s.fees.totals.outstandingPaise), tone: s.fees.totals.outstandingPaise ? 'red' : '' }] : []),
      ...(s.results ? [{ label: 'CGPA', value: s.results.cgpa ?? '—' }] : [])
    ])}
    ${s.attendance ? card('Attendance by subject', dataTable([{ label: 'Subject', render: x => x.subject }, { label: 'Attended', cls: 'right', render: x => `${x.attended}/${x.eligible}` },
      { label: '%', cls: 'right', render: x => (x.percentage === null ? '—' : `${x.percentage}%`) }, { label: '', render: x => (x.belowThreshold ? badge('red', 'Shortage') : '') }], s.attendance.subjects)) : ''}
    ${s.leave ? card('Leave', dataTable([{ label: 'Type', render: x => x.type }, { label: 'Dates', render: x => `${formatDate(x.fromDate)}${x.toDate !== x.fromDate ? ` – ${formatDate(x.toDate)}` : ''}` }, { label: 'Status', render: x => x.status }], s.leave, { empty: 'No leave requests.' })) : ''}
    ${s.results ? card('Published results', dataTable([{ label: 'Semester', render: x => `${x.session} · Sem ${x.semesterNumber}` }, { label: 'GPA', render: x => x.gpa ?? '—' }, { label: 'Result', render: x => x.status || '—' }], s.results.semesters, { empty: 'No published results.' })) : ''}
    ${card('Timeline', html`<div id="tl"></div>`)}
    <p class="small muted">The college decides what is shared. Mentor notes and medical details are never shown here.</p>`);
  await mountTimeline(view.querySelector('#tl'), q => parentApi.timeline(params.id, { ...q, limit: 20 }), { allowed: ['attendance', 'leave', 'fees', 'payments', 'results', 'announcements'].filter(c => s.shared[c] !== false) });
}
