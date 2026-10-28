import { html, mount } from '../../utils/dom.js';
import { adminApi, feeAdminApi, dutyLeaveApi } from '../../api/endpoints.js';
import { financeApi, timetableApi } from '../../api/phase2.js';
import { emptyState } from '../../components/ui.js';
import { can, statCards } from '../../components/kit.js';
import { formatDate, formatDateLong, formatMoney } from '../../utils/format.js';

export default async function render({ view, ctx }) {
  const showFees = ctx.user.role !== 'admin';   // fee information is part of the administration (staff) interface
  const [o, alerts, fees, leave, refunds, unmarked] = await Promise.all([
    adminApi.overview(), null, showFees && can(ctx, 'fees.view', 'payments.view') ? feeAdminApi.summary().catch(() => null) : null,
    can(ctx, 'leave.review') ? dutyLeaveApi.unassigned({ limit: 1 }).catch(() => null) : null,
    showFees && can(ctx, 'refunds.approve') ? financeApi.refunds({ status: 'requested', limit: 1 }).catch(() => null) : null,
    can(ctx, 'attendance.view') ? timetableApi.unmarked().catch(() => null) : null
  ]);
  const count = r => r && (r.meta.total ?? r.rows.length);
  const attention = [
    leave && { label: 'Leave requests with no mentor to decide them', n: count(leave), href: '#duty-leave' },
    refunds && { label: 'Refunds waiting for approval', n: count(refunds), href: '#fees/refunds' },
    unmarked && { label: 'Classes held without attendance', n: unmarked.length, href: '#attendance' },
    fees && fees.needsReview ? { label: 'Payments verified but not applied', n: fees.needsReview, href: '#fees/transactions' } : null
  ].filter(Boolean);
  const open = attention.filter(a => a.n > 0);

  mount(view, html`
    <div class="dash-head"><div><h1>Overview</h1><div class="sub">${ctx.user.collegeName} · ${formatDateLong()}</div></div></div>
    ${statCards([
      { label: 'Students enrolled', value: o.students, hint: `${o.sections} sections` },
      { label: 'Classes this month', value: o.sessionsThisMonth, hint: 'Attendance sessions recorded' },
      ...(fees ? [{ label: 'Fees collected', value: formatMoney(fees.collectedPaise), hint: 'Verified payments' }, { label: 'Fees outstanding', value: formatMoney(fees.outstandingPaise), tone: fees.outstandingPaise ? 'red' : '', hint: 'Across assigned fees' }] : [])
    ])}
    <div class="dash-layout">
      <div class="dash-main">
        <section><div class="sec-head"><h2>Needs your attention</h2></div>
          ${open.length ? html`<div class="rows">${open.map(a => html`<div class="row-item alert"><div class="title">${a.label}</div><div class="flex gap-12"><b class="num">${a.n}</b><a class="btn btn-outline btn-sm" href="${a.href}">Open</a></div></div>`)}</div>`
            : html`<div class="attention ok"><div class="title">Nothing is waiting</div><div class="muted small">No pending approvals, shortages or unreconciled payments.</div></div>`}
        </section>
        <section><div class="sec-head"><h2>Recent attendance sessions</h2><a class="btn-link" href="#attendance">Reports</a></div>
          <div class="rows">${o.recent.length ? o.recent.map(s => html`<div class="row-item"><div><div class="title">${s.subject ? s.subject.name : 'Subject'}</div>
            <div class="meta">${s.section ? `${s.section.name} · ${s.section.sem}` : ''} · ${s.teacher ? s.teacher.name : 'Unassigned'} · ${formatDate(s.date)}, ${s.slot}</div></div>
            <span class="badge ${s.counts.absent ? 'badge-amber' : 'badge-green'}">${s.counts.present}/${s.counts.present + s.counts.absent} present</span></div>`) : emptyState('No sessions recorded yet.')}</div>
        </section>
      </div>
      <aside class="dash-rail">
        ${fees ? html`<section><div class="sec-head"><h2>Payments</h2><a class="btn-link" href="#fees/transactions">All</a></div><div class="card card-pad">
          <div class="money-line"><span class="muted">Successful</span><b>${fees.byStatus.success ? fees.byStatus.success.count : 0}</b></div>
          <div class="money-line"><span class="muted">Failed</span><b>${fees.byStatus.failed ? fees.byStatus.failed.count : 0}</b></div>
          <div class="money-line"><span class="muted">Pending</span><b>${fees.byStatus.pending ? fees.byStatus.pending.count : 0}</b></div>
          <div class="money-line"><span class="muted">Needs reconciliation</span><b class="${fees.needsReview ? 'text-red' : ''}">${fees.needsReview}</b></div></div></section>` : ''}
        ${can(ctx, 'analytics.view') ? html`<section><div class="sec-head"><h2>Insight</h2></div><p class="muted small" style="margin:0">Attendance trends, fee collection and results are on the <a class="btn-link" href="#analytics">Analytics</a> page.</p></section>` : ''}
      </aside>
    </div>`);
}
