import { html, mount, delegate } from '../utils/dom.js';
import { badge } from './kit.js';
import { emptyState } from './ui.js';
import { formatDateTime } from '../utils/format.js';

const LABELS = { attendance: 'Attendance', leave: 'Leave', fees: 'Fees', payments: 'Payments', results: 'Results', assignments: 'Coursework', announcements: 'Notices', mentoring: 'Mentoring' };
const TONES = { attendance: 'red', leave: 'amber', fees: 'blue', payments: 'green', results: 'green', assignments: 'blue', announcements: 'gray', mentoring: 'gray' };

/**
 * Renders the unified activity timeline into `host`. `fetchPage({ categories, before })` returns
 * { events, nextBefore, categories }; the timeline itself is derived on the server from the real records.
 */
export async function mountTimeline(host, fetchPage, { allowed = Object.keys(LABELS) } = {}) {
  let selected = new Set(allowed);
  let events = []; let next = null;

  const paint = () => mount(host, html`
    <div class="toolbar" role="group" aria-label="Filter by type">${allowed.map(c => html`<label class="check" style="margin:0"><input type="checkbox" data-cat="${c}" ${selected.has(c) ? 'checked' : ''}> ${LABELS[c]}</label>`)}</div>
    ${events.length ? html`<div class="card">${events.map(e => html`<div class="list-row"><div><div class="strong">${e.title}</div>
      ${e.detail ? html`<div class="small muted">${e.detail}</div>` : ''}<div class="small faint">${formatDateTime(e.at)}</div></div>${badge(TONES[e.category] || 'gray', LABELS[e.category] || e.category)}</div>`)}</div>`
      : html`<div class="card">${emptyState('Nothing to show for these filters.')}</div>`}
    ${next ? html`<div class="mt-12" style="text-align:center"><button type="button" class="btn btn-outline" data-more>Load older activity</button></div>` : ''}`);

  const load = async append => {
    const page = await fetchPage({ categories: [...selected].join(','), before: append ? next : undefined });
    events = append ? events.concat(page.events) : page.events;
    next = page.nextBefore;
    paint();
  };
  delegate(host, 'change', '[data-cat]', (e, box) => { box.checked ? selected.add(box.dataset.cat) : selected.delete(box.dataset.cat); if (!selected.size) selected = new Set(allowed); load(false); });
  delegate(host, 'click', '[data-more]', () => load(true));
  await load(false);
}
