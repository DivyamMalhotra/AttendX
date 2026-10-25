import { html, mount, delegate } from '../../utils/dom.js';
import { noticeApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, statusPill, badge, act, can, formModal, confirmThen } from '../../components/kit.js';
import { openModal } from '../../components/modal.js';
import { formatDateTime } from '../../utils/format.js';

const ROLES = [['student', 'Students'], ['teacher', 'Teachers'], ['staff', 'Staff'], ['parent', 'Parents']];

export default async function render({ view, ctx, refresh }) {
  const rows = await noticeApi.manage();
  const publisher = can(ctx, 'announcements.publish');
  mount(view, html`
    ${pageHeader('Announcements', 'Circulars and notices for students, staff and parents.', publisher ? html`<button class="btn btn-primary" id="new">New announcement</button>` : '')}
    ${dataTable([
      { label: 'Title', render: a => html`<span class="cell-strong">${a.title}</span><div class="small muted">${a.audience && a.audience.all ? 'Everyone' : [...(a.audience.roles || []), ...((a.audience.semesters || []).map(s => `Sem ${s}`))].join(', ') || 'Selected groups'}</div>` },
      { label: 'Priority', render: a => badge(a.priority === 'urgent' ? 'red' : a.priority === 'high' ? 'amber' : 'gray', a.priority) },
      { label: 'Status', render: a => statusPill(a.expired ? 'closed' : a.status) },
      { label: 'Published', render: a => formatDateTime(a.publishedAt) },
      { label: '', cls: 'right', render: a => html`<button class="btn btn-outline btn-sm" data-stats="${a._id}">Readers</button>
        ${publisher && a.status === 'draft' ? html` <button class="btn btn-primary btn-sm" data-pub="${a._id}">Publish</button>` : ''}
        ${publisher && a.status === 'published' ? html` <button class="btn btn-ghost btn-sm" data-wd="${a._id}">Withdraw</button>` : ''}` }
    ], rows, { empty: 'No announcements yet.' })}`);

  view.querySelector('#new')?.addEventListener('click', () => formModal({
    title: 'New announcement', submit: 'Save', wide: true,
    fields: [
      { name: 'title', label: 'Title', required: true, maxlength: 160 }, { name: 'body', type: 'textarea', label: 'Message', required: true, rows: 6, max: 10000 },
      { name: 'priority', type: 'select', label: 'Priority', options: ['normal', 'high', 'urgent', 'low'].map(v => ({ value: v, label: v })) },
      { name: 'everyone', type: 'checkbox', label: 'Send to everyone in the college', value: true },
      ...ROLES.map(([k, l]) => ({ name: `role_${k}`, type: 'checkbox', label: `Only ${l.toLowerCase()} (when "everyone" is unticked)` })),
      { name: 'notifyEmail', type: 'checkbox', label: 'Also send by email (urgent notices are always emailed)' },
      { name: 'publishNow', type: 'checkbox', label: 'Publish immediately', value: true },
      { name: 'file', type: 'file', label: 'Attachment', accept: '.pdf,.png,.jpg,.jpeg,.docx,.pptx,.xlsx,.txt' }
    ],
    async onSubmit(v) {
      const roles = ROLES.map(([k]) => k).filter(k => v[`role_${k}`]);
      if (!v.everyone && !roles.length) throw new Error('Choose who should receive it.');
      const form = new FormData();
      form.append('title', v.title); form.append('body', v.body); form.append('priority', v.priority);
      form.append('audience', JSON.stringify(v.everyone ? { all: true } : { roles }));
      form.append('notifyEmail', String(v.notifyEmail)); form.append('publishNow', String(v.publishNow));
      if (v.file) form.append('files', v.file, v.file.name);
      await noticeApi.create(form);
      refresh();
    }
  }));
  delegate(view, 'click', '[data-pub]', (e, b) => confirmThen({ title: 'Publish', message: 'Recipients will be notified.', confirmText: 'Publish', run: () => noticeApi.publish(b.dataset.pub), success: 'Published.', after: refresh }));
  delegate(view, 'click', '[data-wd]', (e, b) => confirmThen({ title: 'Withdraw', message: 'It disappears from everyone\'s feed.', confirmText: 'Withdraw', danger: true, run: () => noticeApi.withdraw(b.dataset.wd), success: 'Withdrawn.', after: refresh }));
  delegate(view, 'click', '[data-stats]', async (e, b) => {
    const s = await noticeApi.stats(b.dataset.stats);
    openModal({ title: 'Readers', footer: false, body: html`<p>${s.read} of ${s.recipients} have read it.</p>${s.unreadNames.length ? html`<div class="small muted">Not yet read: ${s.unreadNames.map(u => u.name).join(', ')}</div>` : ''}` });
  });
}
