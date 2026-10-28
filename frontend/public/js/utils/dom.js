/**
 * Safe HTML templating. `html` escapes every interpolated value unless it is already a
 * Safe fragment (another html`` result or raw()), so user data can never inject markup.
 */
export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);

/** Marks a string as trusted markup. Only use for developer-authored constants (icons). */
export const raw = s => new Safe(String(s));

const part = v => {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
};

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += part(values[i]);
  });
  return new Safe(out);
}

/** Replaces an element's content with a safe fragment, an array of fragments, or escaped text. */
export const mount = (el, content) => { el.innerHTML = part(content); };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Event delegation: one listener on `root` for every current and future `selector` match. */
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, event => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

/** Debounce for search boxes. */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
