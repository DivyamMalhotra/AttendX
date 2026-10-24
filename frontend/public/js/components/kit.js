import { html, mount, delegate } from '../utils/dom.js';
import { openModal, confirmDialog } from './modal.js';
import { readForm, requireFields } from './forms.js';
import { toast } from './toast.js';
import { emptyState } from './ui.js';
import { cap } from '../utils/format.js';

/**
 * Small building blocks for list-and-form pages: a declarative form (rendered into a modal), a table, stat cards
 * and permission helpers. Everything user-supplied goes through the escaping `html` template.
 */

export const can = (ctx, ...perms) => perms.some(p => ctx.user.permissions && ctx.user.permissions.includes(p));

export const badge = (tone, text) => html`<span class="badge badge-${tone}">${cap(text)}</span>`;

const STATUS_TONES = {
  active: 'green', published: 'green', approved: 'green', completed: 'green', paid: 'green', success: 'green', ok: 'green', returned: 'green', checked_in: 'green',
  pending: 'amber', requested: 'amber', processing: 'amber', draft: 'gray', previewed: 'amber', submitted: 'blue', reviewed: 'blue', locked: 'blue', allocated: 'blue', issued: 'blue',
  rejected: 'red', failed: 'red', cancelled: 'gray', closed: 'gray', ended: 'gray', withdrawn: 'gray', waived: 'gray', void: 'gray', lost: 'red', unmarked: 'red', skipped: 'gray', open: 'blue'
};
export const statusPill = (status, label) => badge(STATUS_TONES[status] || 'gray', label || status);

export const statCards = items => html`<div class="stat-grid">${items.map(s => html`<div class="stat-card">
  <div class="stat-label">${s.label}</div><div class="stat-value ${s.tone ? `text-${s.tone}` : ''}">${s.value}</div>${s.hint ? html`<div class="stat-hint">${s.hint}</div>` : ''}</div>`)}</div>`;

/** columns: [{ label, render(row), cls }]. Rows are plain objects; render may return html or text. */
export function dataTable(columns, rows, { empty = 'Nothing to show yet.', rowClass } = {}) {
  return html`<div class="table-wrap"><table>
    <thead><tr>${columns.map(c => html`<th class="${c.cls || ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.length ? rows.map(r => html`<tr class="${rowClass ? rowClass(r) : ''}">${columns.map(c => html`<td class="${c.cls || ''}">${c.render(r)}</td>`)}</tr>`)
      : html`<tr><td colspan="${columns.length}">${emptyState(empty)}</td></tr>`}</tbody></table></div>`;
}

export const card = (title, body, actions = '') => html`<div class="card" style="margin-bottom:16px"><div class="card-title"><span>${title}</span>${actions ? html`<span class="flex gap-8 wrap">${actions}</span>` : ''}</div><div class="card-pad">${body}</div></div>`;

let uid = 0;
/** One form control from a field spec. */
export function fieldHtml(f) {
  const id = `f${(uid += 1)}`;
  const req = f.required ? ' required' : '';
  const hint = f.hint ? html`<div class="field-hint">${f.hint}</div>` : '';
  const label = f.label ? html`<label for="${id}">${f.label}${f.required ? '' : html` <span class="faint">(optional)</span>`}</label>` : '';
  const val = f.value ?? '';
  let control;
  switch (f.type) {
    case 'textarea': control = html`<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" maxlength="${f.max || 2000}" placeholder="${f.placeholder || ''}">${val}</textarea>`; break;
    case 'select': control = html`<select id="${id}" name="${f.name}">${(f.options || []).map(o => html`<option value="${o.value}" ${String(o.value) === String(val) ? 'selected' : ''}>${o.label}</option>`)}</select>`; break;
    case 'checkbox': return html`<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${f.label}</label>${hint}`;
    case 'file': control = html`<input id="${id}" name="${f.name}" type="file" ${f.accept ? html`accept="${f.accept}"` : ''}>`; break;
    default: control = html`<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${val}" placeholder="${f.placeholder || ''}"${f.min !== undefined ? html` min="${f.min}"` : ''}${f.max !== undefined ? html` max="${f.max}"` : ''}${f.step !== undefined ? html` step="${f.step}"` : ''}${f.autocomplete ? html` autocomplete="${f.autocomplete}"` : ''} maxlength="${f.maxlength || 200}">`;
  }
  return html`<div class="field">${label}${control}${hint}</div>`;
}

export function formHtml(fields) {
  const out = []; let i = 0;
  while (i < fields.length) {
    if (fields[i].half && fields[i + 1] && fields[i + 1].half) { out.push(html`<div class="field-row">${fieldHtml(fields[i])}${fieldHtml(fields[i + 1])}</div>`); i += 2; } else { out.push(fieldHtml(fields[i])); i += 1; }
  }
  return html`<form>${out}</form>`;
}

/**
 * Opens a modal form. `onSubmit(values, { el, close })` may throw an ApiError (shown in the dialog) or return false.
 * Values come from readForm: strings trimmed, checkboxes booleans, files as File objects.
 */
export function formModal({ title, fields, submit = 'Save', intro = '', wide = false, onSubmit }) {
  const required = fields.filter(f => f.required && f.type !== 'checkbox').map(f => f.name);
  return openModal({
    title, confirmText: submit, wide,
    body: html`${intro ? html`<p class="muted small" style="margin-top:0">${intro}</p>` : ''}${formHtml(fields)}`,
    async onConfirm(el, h) {
      const missing = requireFields(el, required);
      if (missing) { h.showError(missing); return false; }
      return onSubmit(readForm(el), { el, ...h });
    }
  });
}

/** Runs an async action behind a confirmation, with a toast for the outcome. */
export async function confirmThen({ title, message, confirmText = 'Confirm', danger = false, run, success = 'Done.', after }) {
  if (!await confirmDialog({ title, message, confirmText, danger })) return;
  try { await run(); toast(success, 'success'); if (after) after(); } catch (err) { toast(err.message || 'That did not work.', 'error'); }
}

/** Runs an action from a button with error toast, then refreshes. */
export async function act(run, { success, after } = {}) {
  try { await run(); if (success) toast(success, 'success'); if (after) after(); } catch (err) { toast(err.message || 'That did not work.', 'error'); }
}

export { html, mount, delegate, toast };

/** Tabs bar for pages with several panels. Panels render lazily via `render(key)`. */
export function tabs(view, items, { initial, render }) {
  let current = initial || items[0].key;
  const body = document.createElement('div');
  const bar = document.createElement('div');
  bar.className = 'toolbar'; bar.setAttribute('role', 'tablist');
  const paint = () => {
    mount(bar, html`${items.map(t => html`<button type="button" role="tab" class="btn ${t.key === current ? 'btn-primary' : 'btn-outline'} btn-sm" aria-selected="${t.key === current}" data-tab="${t.key}">${t.label}</button>`)}`);
  };
  const show = async () => { paint(); mount(body, html`<div class="skeleton" style="height:48px"></div>`); try { await render(current, body); } catch (e) { mount(body, html`<div class="notice notice-danger" role="alert"><div>${e.message}</div></div>`); } };
  delegate(bar, 'click', '[data-tab]', (e, b) => { current = b.dataset.tab; show(); });
  view.append(bar, body);
  return show();
}

export const money = paise => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100);
