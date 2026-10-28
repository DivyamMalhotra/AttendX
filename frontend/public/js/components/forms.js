import { $, $$ } from '../utils/dom.js';

/** Removes error styling/messages previously added by applyFieldErrors. */
export function clearFieldErrors(root) {
  $$('.field.invalid', root).forEach(f => f.classList.remove('invalid'));
  $$('.field-error[data-for]', root).forEach(e => e.remove());
}

/**
 * Shows server side validation messages next to their inputs.
 * `details` is the API's [{ field, message }] list; inputs are matched by their `name`.
 */
export function applyFieldErrors(root, details) {
  if (!Array.isArray(details)) return;
  details.forEach(d => {
    const input = d && d.field ? $(`[name="${d.field}"]`, root) : null;
    const field = input && input.closest('.field');
    if (!field) return;
    field.classList.add('invalid');
    const msg = document.createElement('div');
    msg.className = 'field-error';
    msg.dataset.for = d.field;
    msg.textContent = d.message;
    field.appendChild(msg);
  });
}

/** Reads a form into a plain object (trimmed strings; empty strings kept so callers can decide). */
export function readForm(root) {
  const out = {};
  $$('[name]', root).forEach(el => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'file') out[el.name] = el.files[0] || null;
    else out[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
  });
  return out;
}

/** Client-side required check that mirrors (but never replaces) the server validation. */
export function requireFields(root, names, message = 'Please fill in all required fields.') {
  const missing = names.filter(n => {
    const el = $(`[name="${n}"]`, root);
    return !el || !String(el.value || '').trim();
  });
  missing.forEach(n => $(`[name="${n}"]`, root)?.closest('.field')?.classList.add('invalid'));
  return missing.length ? message : null;
}
