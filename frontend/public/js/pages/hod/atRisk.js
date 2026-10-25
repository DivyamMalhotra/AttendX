import { html, mount, delegate } from '../../utils/dom.js';
import { analyticsApi, mentorApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, badge, act, can } from '../../components/kit.js';
import { openModal } from '../../components/modal.js';
import { mountTimeline } from '../../components/timeline.js';
import { formatMoney } from '../../utils/format.js';

const TONE = { attendance: 'red', fees: 'amber', results: 'red', assignments: 'blue' };

export default async function render({ view, ctx }) {
  const { rows, meta } = await analyticsApi.atRisk({ limit: 200 });
  const exportable = can(ctx, 'reports.export');
  const showTimeline = can(ctx, 'timeline.view');
  mount(view, html`
    ${pageHeader('At-risk students', `${meta.total} flagged · attendance below ${meta.criteria.attendanceBelow}%${meta.criteria.flagOverdueFees ? ', overdue fees' : ''}${meta.criteria.flagFailingResults ? ', failed subjects' : ''}${meta.criteria.flagMissingAssignments ? ', missing work' : ''}`,
      exportable ? html`<button type="button" class="btn btn-outline" id="exp">Export CSV</button>` : '')}
    ${dataTable([
      { label: 'Roll no', render: r => r.rollNo }, { label: 'Student', render: r => html`<span class="cell-strong">${r.name}</span><div class="small muted">${r.section || ''}</div>` },
      { label: 'Attendance', cls: 'right', render: r => (r.attendance === null ? '—' : `${r.attendance}%`) },
      { label: 'Why', render: r => html`<div class="flex gap-8 wrap">${r.flags.map(f => badge(TONE[f.code] || 'gray', f.code === 'fees' ? `${f.detail} ${formatMoney(f.amountPaise)}` : f.detail))}</div>` },
      { label: '', cls: 'right', render: r => (showTimeline ? html`<button class="btn btn-outline btn-sm" data-tl="${r.studentId}" data-name="${r.name}">Timeline</button>` : '') }
    ], rows, { empty: 'Nobody is flagged right now.' })}
    <p class="small muted">The list shows flags only. Counselling notes and medical leave are never included. Criteria are set under Settings.</p>`);
  view.querySelector('#exp')?.addEventListener('click', () => act(() => analyticsApi.exportAtRisk()));
  delegate(view, 'click', '[data-tl]', (e, b) => {
    openModal({ title: `Timeline: ${b.dataset.name}`, wide: true, footer: false, body: html`<div id="tlHost"></div>`, onOpen: el => mountTimeline(el.querySelector('#tlHost'), q => mentorApi.adminTimeline(b.dataset.tl, { ...q, limit: 30 }), { allowed: ['attendance', 'leave', 'fees', 'results', 'assignments', 'mentoring'] }) });
  });
}
