import { html, mount } from '../../utils/dom.js';
import { timetableApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { formatDate } from '../../utils/format.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOUR = 56;   // px per hour in the week grid
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Weekly grid with a time axis and a live "now" line on desktop; a day-by-day agenda on phones. */
export default async function render({ view }) {
  const t = await timetableApi.studentWeek();
  const week = t.week;
  const jsToIso = new Date().getDay() || 7;           // Mon=1 … Sun=7
  const days = DAYS.map((name, i) => ({ name, n: i + 1, rows: week.filter(e => e.dayOfWeek === i + 1) })).filter(d => d.rows.length || d.n <= 5);
  const start = week.length ? Math.floor(Math.min(...week.map(e => mins(e.startTime))) / 60) : 8;
  const end = week.length ? Math.ceil(Math.max(...week.map(e => mins(e.endTime))) / 60) : 17;
  const hours = Array.from({ length: end - start }, (_, i) => start + i);
  const changes = t.upcoming.filter(c => c.status === 'cancelled');

  mount(view, html`
    ${pageHeader('Timetable', 'Your weekly classes. Changes in the next 7 days appear as notices.')}
    ${changes.length ? html`<div class="notice notice-warning" role="status"><div><div class="notice-title">Class changes</div>
      ${changes.map(c => html`<div>${formatDate(c.date)} · ${c.subject}${c.startTime ? ` (${c.startTime})` : ''}: cancelled${c.cancelReason ? ` — ${c.cancelReason}` : ''}</div>`)}</div></div>` : ''}
    ${week.length ? html`
      <div class="tt" style="--cols:${days.length}">
        <div class="tt-head"><span></span>${days.map(d => html`<span class="${d.n === jsToIso ? 'today' : ''}">${d.name.slice(0, 3)}</span>`)}</div>
        <div class="tt-body" style="height:${hours.length * HOUR}px">
          <div class="tt-axis">${hours.map(h => html`<span style="top:${(h - start) * HOUR}px">${String(h).padStart(2, '0')}:00</span>`)}</div>
          ${days.map(d => html`<div class="tt-col ${d.n === jsToIso ? 'today' : ''}" data-day="${d.n}">
            ${hours.map(h => html`<i class="tt-line" style="top:${(h - start) * HOUR}px"></i>`)}
            ${d.rows.map(e => html`<div class="tt-ev" style="top:${((mins(e.startTime) - start * 60) * HOUR) / 60}px;height:${Math.max(30, ((mins(e.endTime) - mins(e.startTime)) * HOUR) / 60 - 2)}px" title="${e.subject} · ${e.teacher || ''}">
              <b>${e.subject}</b><span>${e.startTime}–${e.endTime}</span>${e.room ? html`<span>Room ${e.room}</span>` : ''}</div>`)}
            ${d.n === jsToIso ? html`<div class="tt-now" id="ttNow" hidden></div>` : ''}
          </div>`)}
        </div>
      </div>
      <div class="tt-agenda" aria-label="Agenda">${days.filter(d => d.rows.length).map(d => html`<section><h2 class="agenda-day ${d.n === jsToIso ? 'today' : ''}">${d.name}${d.n === jsToIso ? ' · today' : ''}</h2>
        <div class="rows">${d.rows.map(e => html`<div class="row-item"><div><div class="title">${e.subject}</div><div class="meta">${e.teacher || ''}${e.room ? ` · Room ${e.room}` : ''}</div></div><span class="num">${e.startTime}–${e.endTime}</span></div>`)}</div></section>`)}</div>
      <h2 class="sec-title">Next 7 days</h2>
      <div class="rows">${t.upcoming.map(c => html`<div class="row-item ${c.status === 'cancelled' ? 'alert' : ''}"><div><div class="title">${c.subject}</div><div class="meta">${formatDate(c.date)} · ${c.startTime ? `${c.startTime}–${c.endTime}` : c.slot}${c.room ? ` · Room ${c.room}` : ''}</div></div>
        ${c.status === 'cancelled' ? html`<span class="badge badge-red">Cancelled</span>` : c.status === 'submitted' ? html`<span class="badge badge-green">Held</span>` : html`<span class="badge badge-gray">Scheduled</span>`}</div>`)}</div>`
      : html`<div class="card">${emptyState('No timetable has been published for your class yet.')}</div>`}`);

  const now = view.querySelector('#ttNow');
  if (now) {
    const place = () => { const d = new Date(); const m = d.getHours() * 60 + d.getMinutes(); const y = ((m - start * 60) * HOUR) / 60; now.hidden = y < 0 || y > hours.length * HOUR; now.style.top = `${y}px`; };
    place();
    const timer = setInterval(() => { if (!document.body.contains(now)) clearInterval(timer); else place(); }, 60000);
  }
}
