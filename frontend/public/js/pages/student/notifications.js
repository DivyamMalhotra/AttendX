import { html, mount, delegate } from '../../utils/dom.js';
import { studentApi } from '../../api/endpoints.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { formatDateTime } from '../../utils/format.js';

const TONE = { attendance_shortage: 'red', attendance_recovered: 'green', duty_leave: 'blue', payment: 'green' };
const LABEL = { attendance_shortage: 'Attendance', attendance_recovered: 'Attendance', duty_leave: 'Duty leave', payment: 'Payment' };

export default async function render({ view, ctx, refresh }) {
  const { rows, meta } = await studentApi.notifications({ limit: 50 });
  ctx.shell.setBadge('notifications', meta.unread || 0);

  mount(view, html`
    ${pageHeader('Notifications', `${meta.unread} unread`,
      meta.unread ? html`<button type="button" class="btn btn-outline" id="readAll">Mark all as read</button>` : '')}
    <div class="card">
      ${rows.length ? rows.map(n => html`<div class="list-row" style="${n.read ? '' : 'background:var(--sage-2)'}">
        <div style="min-width:0;flex:1">
          <div class="flex gap-8 wrap"><span class="badge badge-${TONE[n.type] || 'gray'}">${LABEL[n.type] || 'Update'}</span>
            ${n.read ? '' : html`<span class="badge badge-blue">New</span>`}</div>
          <div class="strong mt-8">${n.title}</div>
          <div class="muted small">${n.message}</div>
          <div class="faint small mt-8">${formatDateTime(n.createdAt)}</div>
        </div>
        ${n.read ? '' : html`<button type="button" class="btn btn-ghost btn-sm" data-read="${n._id}">Mark as read</button>`}
      </div>`) : emptyState('You have no notifications.')}
    </div>`);

  delegate(view, 'click', '[data-read]', async (e, btn) => {
    try { await studentApi.markRead(btn.dataset.read); refresh(); } catch (err) { toast(err.message, 'error'); }
  });
  view.querySelector('#readAll')?.addEventListener('click', async () => {
    try { await studentApi.markAllRead(); refresh(); } catch (err) { toast(err.message, 'error'); }
  });
}
