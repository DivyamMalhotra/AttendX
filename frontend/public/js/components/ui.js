import { html } from '../utils/dom.js';
import { formatPct, cap } from '../utils/format.js';

const BADGES = {
  // fee / payment
  paid: ['green', 'Paid'], partial: ['amber', 'Partial'], unpaid: ['red', 'Unpaid'],
  success: ['green', 'Successful'], failed: ['red', 'Failed'], pending: ['amber', 'Pending'], created: ['gray', 'Not completed'], cancelled: ['gray', 'Cancelled'],
  // duty leave
  approved: ['green', 'Approved'], rejected: ['red', 'Rejected'],
  // attendance
  good: ['green', 'Good'], borderline: ['amber', 'Borderline'], shortage: ['red', 'Shortage'], no_data: ['gray', 'No classes yet']
};

export function statusBadge(status, labelOverride) {
  const [tone, label] = BADGES[status] || ['gray', status];
  return html`<span class="badge badge-${tone}">${cap(labelOverride || label)}</span>`;
}

export const toneFor = (pct, threshold) => (pct === null || pct === undefined ? '' : pct < threshold ? 'red' : pct < threshold + 5 ? 'amber' : 'green');

/** Attendance bar with a tick at the required threshold. */
export function progressBar(pct, threshold, { wide = false } = {}) {
  if (pct === null || pct === undefined) return html`<span class="faint small">No classes yet</span>`;
  return html`<div class="progress-wrap">
    <div class="progress-track ${wide ? 'wide' : ''}" role="img" aria-label="Attendance ${formatPct(pct)}, required ${threshold}%">
      <div class="progress-fill ${toneFor(pct, threshold)}" style="width:${Math.min(100, pct)}%"></div>
      <div class="mark" style="left:${threshold}%"></div>
    </div>
    <span class="progress-pct">${formatPct(pct)}</span>
  </div>`;
}

export const loadingBlock = (rows = 3) => html`<div class="stack" aria-busy="true" aria-label="Loading">
  ${Array.from({ length: rows }, () => html`<div class="skeleton" style="height:${52}px"></div>`)}</div>`;

export const emptyState = (message, action = '') => html`<div class="empty-state">${message}${action ? html`<div class="mt-12">${action}</div>` : ''}</div>`;

export const errorState = message => html`<div class="notice notice-danger" role="alert"><div><div class="notice-title">We could not load this page</div>${message}
  <div class="mt-8"><button type="button" class="btn btn-outline btn-sm" data-retry>Try again</button></div></div></div>`;

/** Table pager. Renders nothing when everything fits on one page. */
export function pager(meta) {
  if (!meta || !meta.pages || meta.pages <= 1) return html`<div class="pager"><span>${meta?.total ?? 0} total</span></div>`;
  return html`<div class="pager">
    <span>${meta.total} total · page ${meta.page} of ${meta.pages}</span>
    <span class="flex gap-8">
      <button type="button" class="btn btn-outline btn-sm" data-page="${meta.page - 1}" ${meta.page <= 1 ? 'disabled' : ''}>Previous</button>
      <button type="button" class="btn btn-outline btn-sm" data-page="${meta.page + 1}" ${meta.page >= meta.pages ? 'disabled' : ''}>Next</button>
    </span></div>`;
}

export function pageHeader(title, subtitle, actions = '') {
  return html`<div class="page-header-row"><div><h1>${title}</h1>${subtitle ? html`<div class="sub">${subtitle}</div>` : ''}</div>${actions ? html`<div class="flex gap-8 wrap">${actions}</div>` : ''}</div>`;
}

export const notice = (tone, title, body, extra = '') => html`<div class="notice notice-${tone}" role="${tone === 'danger' ? 'alert' : 'note'}"><div>
  ${title ? html`<div class="notice-title">${title}</div>` : ''}${body}${extra}</div></div>`;
