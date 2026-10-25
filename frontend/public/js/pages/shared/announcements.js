import { html, mount, delegate } from '../../utils/dom.js';
import { noticeApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { badge, act } from '../../components/kit.js';
import { formatDateTime } from '../../utils/format.js';

const TONE = { urgent: 'red', high: 'amber', normal: 'blue', low: 'gray' };

/** The announcement feed for any signed-in role: what the college has addressed to this person. */
export default async function render({ view, refresh, ctx }) {
  const items = await noticeApi.feed();
  ctx.live.on('notification', refresh);
  const unread = items.filter(a => !a.read).length;

  mount(view, html`
    ${pageHeader('Announcements', unread ? `${unread} unread` : 'You are up to date')}
    ${items.length ? items.map(a => html`<article class="card card-pad" style="margin-bottom:12px;${a.read ? '' : 'border-left:4px solid var(--blue)'}">
      <div class="flex-between wrap"><h2 style="margin:0;font-size:17px">${a.title}</h2><span class="flex gap-8">${badge(TONE[a.priority] || 'blue', a.priority)}${a.read ? '' : badge('blue', 'New')}</span></div>
      <div class="small faint">${formatDateTime(a.publishedAt)}${a.edited ? ' · edited' : ''}</div>
      <div style="white-space:pre-wrap;margin-top:10px">${a.body}</div>
      ${a.attachments.length ? html`<div class="flex gap-8 wrap mt-12">${a.attachments.map(f => html`<button type="button" class="btn btn-outline btn-sm" data-att="${a.id}:${f.index}:${f.name}">${f.name}</button>`)}</div>` : ''}
      ${a.read ? '' : html`<div class="mt-12"><button type="button" class="btn btn-ghost btn-sm" data-read="${a.id}">Mark as read</button></div>`}
    </article>`) : html`<div class="card">${emptyState('No announcements.')}</div>`}`);

  delegate(view, 'click', '[data-read]', (e, b) => act(() => noticeApi.read(b.dataset.read), { after: refresh }));
  delegate(view, 'click', '[data-att]', (e, b) => { const [id, index, ...name] = b.dataset.att.split(':'); act(() => noticeApi.attachment('announcement', id, index, name.join(':'))); });
  // Opening the page counts as reading what is on screen after a short pause.
  setTimeout(() => { items.filter(a => !a.read).forEach(a => noticeApi.read(a.id).catch(() => {})); }, 6000);
}
