import { html, mount } from '../../utils/dom.js';
import { analyticsApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { statCards, dataTable, card } from '../../components/kit.js';
import { formatMoney } from '../../utils/format.js';

/** Chart.js is served by this server (/vendor/chart.umd.js), loaded only when this page opens. */
function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/chart.umd.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = () => reject(new Error('Charts could not be loaded.'));
    document.head.appendChild(s);
  });
}

export default async function render({ view, ctx }) {
  const [o, Chart] = await Promise.all([analyticsApi.overview(), loadChart().catch(() => null)]);
  const a = o.attendance; const f = ctx.user.role === 'admin' ? null : o.fees;   // fee figures are shown in the administration interface only

  mount(view, html`
    ${pageHeader('Analytics', o.scope === 'department' ? 'Your departments only' : 'Whole college')}
    ${statCards([
      { label: 'Students', value: o.totals.students, hint: `${o.totals.sections} sections` },
      { label: 'Average attendance', value: a && a.average !== null ? `${a.average}%` : '—', hint: a ? `${a.belowThreshold} below ${a.threshold}%` : '' },
      ...(f ? [{ label: 'Fee collection', value: f.collectionRate !== null ? `${f.collectionRate}%` : '—', hint: `${formatMoney(f.outstandingPaise)} outstanding` }] : []),
      { label: 'Result pass rate', value: o.results && o.results.passRate !== null ? `${o.results.passRate}%` : '—', hint: o.results ? `${o.results.exams} published exams` : '' }
    ])}
    ${a ? html`<div class="grid-2" style="margin-bottom:16px">
      ${card('Attendance distribution', html`<canvas id="cDist" height="200" aria-label="Attendance distribution chart" role="img"></canvas>`)}
      ${card('Present rate by week', html`<canvas id="cTrend" height="200" aria-label="Weekly attendance trend" role="img"></canvas>`)}</div>
      ${card('Sections', dataTable([{ label: 'Section', render: s => s.section }, { label: 'Department', render: s => s.department || '—' }, { label: 'Students', cls: 'right', render: s => s.students },
        { label: 'Average', cls: 'right', render: s => (s.average === null ? '—' : `${s.average}%`) }, { label: 'Below threshold', cls: 'right', render: s => s.belowThreshold }], a.bySection))}` : ''}
    ${f ? html`<div class="grid-2" style="margin-bottom:16px">
      ${card('Fees', html`<dl class="kv"><dt>Payable</dt><dd>${formatMoney(f.totalPayablePaise)}</dd><dt>Collected</dt><dd>${formatMoney(f.collectedPaise)}</dd><dt>Outstanding</dt><dd>${formatMoney(f.outstandingPaise)}</dd>
        <dt>Paid / partial / unpaid</dt><dd>${f.counts.paid} / ${f.counts.partial} / ${f.counts.unpaid}</dd><dt>Overdue</dt><dd>${f.counts.overdue} (${formatMoney(f.overduePaise)})</dd></dl>`)}
      ${card('Collections, last 30 days', html`<canvas id="cPay" height="200" aria-label="Daily collections chart" role="img"></canvas>`)}</div>` : ''}
    ${o.departments.length > 1 ? card('Departments', dataTable([{ label: 'Department', render: d => d.department }, { label: 'Students', cls: 'right', render: d => d.students },
      { label: 'Average attendance', cls: 'right', render: d => (d.averageAttendance === null ? '—' : `${d.averageAttendance}%`) }, { label: 'Below threshold', cls: 'right', render: d => d.belowThreshold }], o.departments)) : ''}
    ${o.facilities ? card('Library', html`<dl class="kv"><dt>Books on loan</dt><dd>${o.facilities.library.onLoan} (${o.facilities.library.overdue} overdue)</dd></dl>`) : ''}
    ${o.results && o.results.grades.length ? card('Grade distribution', html`<canvas id="cGrades" height="160" aria-label="Grade distribution chart" role="img"></canvas>`) : ''}`);

  if (!Chart) return;
  const bar = (id, labels, data, label, color = '#315B46') => { const el = view.querySelector(id); if (el) new Chart(el, { type: 'bar', data: { labels, datasets: [{ label, data, backgroundColor: color }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } }); };
  if (a) {
    bar('#cDist', a.distribution.map(d => d.label), a.distribution.map(d => d.students), 'Students');
    const t = view.querySelector('#cTrend');
    if (t) new Chart(t, { type: 'line', data: { labels: o.attendanceTrend.map(w => w.weekStart.slice(5)), datasets: [{ label: 'Present %', data: o.attendanceTrend.map(w => w.presentRate), borderColor: '#7A9A85', spanGaps: true }] }, options: { scales: { y: { min: 0, max: 100 } } } });
  }
  if (f) bar('#cPay', f.last30Days.map(d => d.date.slice(5)), f.last30Days.map(d => d.amountPaise / 100), 'INR', '#7A9A85');
  if (o.results) bar('#cGrades', o.results.grades.map(g => g.grade), o.results.grades.map(g => g.students), 'Students', '#B98A2E');
}
