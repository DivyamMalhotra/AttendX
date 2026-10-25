import { html, mount } from '../../utils/dom.js';
import { facultyApi } from '../../api/endpoints.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { icons } from '../../components/icons.js';
import { formatDate, formatDateLong } from '../../utils/format.js';

const sessionBadge = ({ present, absent }) => {
  const total = present + absent;
  const tone = total === 0 ? 'gray' : present === total ? 'green' : present / total >= 0.75 ? 'blue' : 'red';
  return html`<span class="badge badge-${tone}">${present}/${total}</span>`;
};

export default async function render({ view }) {
  const subjects = await facultyApi.subjects();

  mount(view, html`
    ${pageHeader('My Classes', formatDateLong())}
    ${subjects.length ? subjects.map(s => html`
      <div class="card class-card">
        <div class="class-card-top">
          <div class="class-title-row">
            <div class="class-icon">${icons.classes}</div>
            <div class="class-title"><h3>${s.name}</h3><div class="sub">${s.section.name} · ${s.section.sem}${s.code ? ` · ${s.code}` : ''}</div></div>
          </div>
          <div class="class-actions">
            <a class="btn btn-outline" href="#summary/${s.id}">Attendance summary</a>
            <a class="btn btn-primary" href="#session/new/${s.id}">New Session</a>
          </div>
        </div>
        <div class="class-meta">
          <span class="badge badge-gray">${s.studentCount} students</span>
          <span class="muted small">Last: ${s.sessions[0] ? formatDate(s.sessions[0].date) : '—'}</span>
        </div>
        ${s.sessions.length ? html`<div class="past-sessions"><div class="ps-label">Recent sessions</div>
          ${s.sessions.map(x => html`<div class="ps-row"><span>${formatDate(x.date)}, ${x.slot}</span>
            <span class="ps-right">${sessionBadge(x.counts)}<a class="btn-link" href="#session/edit/${x.id}">Edit</a></span></div>`)}</div>` : ''}
      </div>`) : html`<div class="card">${emptyState('You have no classes assigned yet. Contact your HOD.')}</div>`}
  `);
}
