/**
 * Remembers the selected college code between visits. This is a non-secret convenience only;
 * authentication lives in the server session cookie, never here. Storage may be unavailable
 * (private mode), so every access is guarded.
 */
const KEY = 'attendx_college_code';

export function getCollegeCode() {
  try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
}
export function setCollegeCode(code) {
  try { localStorage.setItem(KEY, code); } catch (e) { /* ignore */ }
}
export function clearCollegeCode() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
