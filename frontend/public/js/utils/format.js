const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** Money arrives from the API as integer paise. */
export const formatMoney = paise => inr.format((paise || 0) / 100);

/** Strict rupee-input parser: "1250", "1250.5", "1,250.50" -> integer paise, or null when invalid. */
export function parseRupees(text) {
  const s = String(text ?? '').replace(/[,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

export const formatPct = p => (p === null || p === undefined ? '—' : `${Number(p).toFixed(p % 1 === 0 ? 0 : 1)}%`);

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDateLong(date = new Date()) {
  return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export const initials = name => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** Today as YYYY-MM-DD in the user's local calendar (the server re-validates in the college timezone). */
export function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Sentence case for labels that come from stored values: first letter capital, underscores read as spaces. */
export const cap = v => { const t = String(v ?? '').replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
