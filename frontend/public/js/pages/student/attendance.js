import { html, mount } from '../../utils/dom.js';
import { studentApi } from '../../api/endpoints.js';
import { pageHeader, progressBar, statusBadge, notice, emptyState } from '../../components/ui.js';
import { formatPct, plural } from '../../utils/format.js';

const POLICY_TEXT = {
  exclude: 'Classes you missed on days covered by approved duty leave are removed from the total, so they do not lower your percentage.',
  count_present: 'Classes you missed on days covered by approved duty leave are counted as attended.'
};

function guidance(r, threshold) {
  if (r.status === 'no_data') return 'No classes held yet.';
  if (r.belowThreshold) {
    return r.classesNeeded === null ? 'The required percentage can no longer be reached.'
      : `Attend the next ${plural(r.classesNeeded, 'class', 'classes')} in a row to reach ${threshold}%.`;
  }
  return r.canSkip > 0 ? `You can miss up to ${plural(r.canSkip, 'class', 'classes')} and stay at ${threshold}% or above.` : `You are at the minimum — do not miss the next class.`;
}

export default async function render({ view }) {
  const data = await studentApi.attendance();
  const { overall, subjects, threshold, shortages } = data;

  mount(view, html`
    ${pageHeader('My Attendance', `Required attendance: ${threshold}% in every subject`)}
    ${shortages.length ? notice('danger', `${plural(shortages.length, 'subject')} below ${threshold}%`,
      shortages.map(r => html`<div>${r.subject.name}: <b>${formatPct(r.percentage)}</b></div>`)) : ''}
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Overall attendance</div>
        <div class="stat-value ${overall.percentage !== null && overall.percentage < threshold ? 'text-red' : 'text-green'}">${formatPct(overall.percentage)}</div>
        <div class="stat-hint">All subjects combined</div></div>
      <div class="stat-card"><div class="stat-label">Attended</div><div class="stat-value">${overall.attended}</div><div class="stat-hint">of ${overall.eligible} eligible classes</div></div>
      <div class="stat-card"><div class="stat-label">Missed</div><div class="stat-value">${overall.missed}</div><div class="stat-hint">Not covered by duty leave</div></div>
      <div class="stat-card"><div class="stat-label">Duty leave exemptions</div><div class="stat-value">${overall.exempt}</div><div class="stat-hint">Approved only</div></div>
    </div>
    <div class="card">
      <div class="card-title">By subject</div>
      ${subjects.length ? subjects.map(r => html`
        <div class="subject-att ${r.belowThreshold ? 'alert-card' : ''}">
          <div class="subject-att-head">
            <div><div class="strong">${r.subject.name} ${r.subject.code ? html`<span class="faint small">· ${r.subject.code}</span>` : ''}</div>
              <div class="small muted">${r.subject.teacher || 'Faculty not assigned'}</div></div>
            <div class="flex gap-10">${statusBadge(r.status)}</div>
          </div>
          <div class="mt-12" style="max-width:420px">${progressBar(r.percentage, threshold, { wide: true })}</div>
          <div class="subject-att-nums">
            <span><b>${r.eligible}</b>Eligible classes</span><span><b>${r.attended}</b>Attended</span>
            <span><b>${r.missed}</b>Missed</span><span><b>${r.exempt}</b>Duty leave exempt</span>
          </div>
          <p class="small ${r.belowThreshold ? 'text-red' : 'muted'}" style="margin:10px 0 0">${guidance(r, threshold)}</p>
        </div>`) : emptyState('No subjects have been set up for your section yet.')}
    </div>
    <p class="small muted mt-16">${POLICY_TEXT[data.dutyLeavePolicy]} Pending or rejected duty leave is never counted. The mark on each bar shows the required ${threshold}%.</p>
  `);
}
