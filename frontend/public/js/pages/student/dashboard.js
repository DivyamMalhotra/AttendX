import { html, mount } from '../../utils/dom.js';
import { studentApi, feesApi } from '../../api/endpoints.js';
import { timetableApi, courseworkApi, noticeApi } from '../../api/phase2.js';
import { statusBadge, emptyState } from '../../components/ui.js';
import { formatPct, formatDateTime, formatMoney, formatDate, formatDateLong, plural } from '../../utils/format.js';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const dayLabel = d => { const t = new Date(); const iso = x => x.toISOString().slice(0, 10); const tomorrow = new Date(Date.now() + 864e5); return d === iso(t) ? 'Today' : d === iso(tomorrow) ? 'Tomorrow' : formatDate(d); };

/** One sentence that says where the student stands, built only from their data. */
function headline({ att, fee, due }) {
  if (att.shortages.length) { const r = att.shortages[0]; return { tone: 'bad', title: `${r.subject.name} needs attention`, body: r.classesNeeded === null ? `Attendance is ${formatPct(r.percentage)} and the ${att.threshold}% requirement can no longer be reached this term. Please speak to your mentor.` : `Attendance is ${formatPct(r.percentage)}, below ${att.threshold}%. Attend the next ${plural(r.classesNeeded, 'class', 'classes')} in a row to recover.` }; }
  if (fee && fee.overdue) return { tone: 'bad', title: 'A fee payment is overdue', body: `${formatMoney(fee.outstandingPaise)} was due on ${formatDate(fee.dueDate)}.` };
  if (due && due[0] && new Date(due[0].deadline) - Date.now() < 48 * 36e5) return { tone: 'warn', title: `"${due[0].title}" is due soon`, body: `Deadline ${formatDateTime(due[0].deadline)}.` };
  return { tone: 'ok', title: 'You are on track', body: 'Attendance meets the requirement and nothing is overdue.' };
}

export default async function render({ view, ctx, refresh }) {
  const [dash, fees, tt, work, notices] = await Promise.all([
    studentApi.dashboard(), feesApi.summary().catch(() => null),
    timetableApi.studentWeek().catch(() => null), courseworkApi.mine().catch(() => null), noticeApi.feed().catch(() => null)
  ]);
  ctx.live.on('notification', refresh);
  const { attendance: att, profile } = dash;
  const fee = fees && fees.current;
  const overall = att.overall;
  const schedule = tt ? tt.upcoming.filter(c => c.status !== 'submitted').slice(0, 6) : null;
  const due = work ? work.filter(a => !a.submission && !a.closed && new Date(a.deadline) >= new Date()).slice(0, 4) : null;
  const note = headline({ att, fee, due });
  const below = overall.percentage !== null && overall.percentage < att.threshold;
  const byDay = schedule ? schedule.reduce((m, c) => { (m[c.date] = m[c.date] || []).push(c); return m; }, {}) : null;

  mount(view, html`
    <header class="ws-head">
      <div><div class="eyebrow">${profile.section ? `${profile.section.name} · ${profile.section.sem}` : 'Student'} · ${formatDateLong()}</div>
        <h1>${greeting()}, ${ctx.user.name.split(' ')[0]}.</h1></div>
      <div class="quick" role="group" aria-label="Quick actions">
        <a class="btn btn-outline btn-sm" href="#qr">Mark attendance</a><a class="btn btn-outline btn-sm" href="#duty-leave">Apply for leave</a>
        ${fee && fee.outstandingPaise > 0 ? html`<a class="btn btn-primary btn-sm" href="#fees">Pay fees</a>` : ''}
      </div>
    </header>

    <section class="focus" aria-labelledby="hFocus">
      <div class="focus-main">
        <h2 id="hFocus" class="sr-only">Attendance health</h2>
        <div class="focus-figure"><span class="big ${below ? 'text-red' : ''}">${formatPct(overall.percentage)}</span><span class="cap">overall attendance<br>${overall.attended} of ${overall.eligible} classes · requirement ${att.threshold}%</span></div>
        <div class="verdict ${note.tone}"><b>${note.title}.</b> ${note.body}</div>
      </div>
      <div class="meters" role="list">${att.subjects.length ? att.subjects.map(r => html`<div class="meter ${r.belowThreshold ? 'low' : ''}" role="listitem">
        <div class="meter-top"><span class="meter-name">${r.subject.name}</span><span class="meter-pct">${formatPct(r.percentage)}</span></div>
        <div class="meter-bar" role="img" aria-label="${r.subject.name}: ${formatPct(r.percentage)} attendance, required ${att.threshold}%"><i style="width:${Math.min(100, r.percentage ?? 0)}%"></i><b style="left:${att.threshold}%"></b></div>
        <div class="meter-sub">${r.eligible ? `${r.attended}/${r.eligible} classes${r.belowThreshold ? ' · below requirement' : ''}` : 'No classes yet'}</div></div>`) : html`<div class="muted">No subjects have been set up for your section yet.</div>`}</div>
    </section>

    <div class="cols-3">
      <section aria-labelledby="hSch"><div class="sec-head"><h2 id="hSch">Schedule</h2><a class="btn-link" href="#timetable">Week view</a></div>
        ${schedule ? (schedule.length ? html`<ol class="timeline">${Object.entries(byDay).map(([d, cs]) => html`<li class="tl-day"><div class="tl-date">${dayLabel(d)}</div>${cs.map(c => html`<div class="tl-item ${c.status === 'cancelled' ? 'off' : ''}">
          <span class="tl-time">${c.startTime || c.slot}</span><span><b>${c.subject}</b>${c.status === 'cancelled' ? html` <span class="badge badge-red">Cancelled</span>` : ''}<span class="meta">${c.room ? ` Room ${c.room}` : ''}</span></span></div>`)}</li>`)}</ol>` : emptyState('No classes in the next 7 days.')) : emptyState('Schedule unavailable.')}
      </section>
      <section aria-labelledby="hPri"><div class="sec-head"><h2 id="hPri">Priorities</h2></div>
        <div class="rows">
          ${fee ? html`<div class="row-item"><div><div class="title">Semester ${fee.semesterNumber} fee</div><div class="meta">${fee.outstandingPaise ? `${formatMoney(fee.outstandingPaise)} outstanding${fee.dueDate ? ` · due ${formatDate(fee.dueDate)}` : ''}` : 'Paid in full'}</div></div>${statusBadge(fee.status)}</div>` : ''}
          ${due && due.length ? due.map(a => html`<div class="row-item"><div><div class="title">${a.title}</div><div class="meta">${a.subject ? a.subject.name : ''} · due ${formatDateTime(a.deadline)}</div></div><a class="btn-link" href="#assignments">Open</a></div>`) : (due ? html`<div class="row-item"><div class="meta">No assignments are waiting.</div></div>` : '')}
          ${dash.pendingDutyLeaves ? html`<div class="row-item"><div><div class="title">${plural(dash.pendingDutyLeaves, 'leave request')} pending</div><div class="meta">Waiting for a decision</div></div><a class="btn-link" href="#duty-leave">View</a></div>` : ''}
        </div>
      </section>
      <section aria-labelledby="hUpd"><div class="sec-head"><h2 id="hUpd">Updates</h2><a class="btn-link" href="#announcements">All notices</a></div>
        <div class="rows">${notices && notices.length ? notices.slice(0, 4).map(n => html`<div class="row-item"><div><div class="title">${n.title}${n.read ? '' : html` <span class="badge badge-green">New</span>`}</div><div class="meta">${formatDate(n.publishedAt)}</div></div></div>`) : html`<div class="row-item"><div class="meta">No announcements.</div></div>`}
          ${dash.alertHistory.slice(0, 2).map(a => html`<div class="row-item"><div><div class="title">${a.subject}: ${a.status === 'active' ? 'attendance alert' : 'alert resolved'}</div><div class="meta">${formatDate(a.openedAt)}</div></div></div>`)}</div>
      </section>
    </div>`);
}
