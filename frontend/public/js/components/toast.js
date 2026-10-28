let region;

function ensureRegion() {
  if (region) return region;
  region = document.createElement('div');
  region.className = 'toast-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.appendChild(region);
  return region;
}

/** Shows a short message. kind: 'info' | 'success' | 'error'. */
export function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  ensureRegion().appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 5000 : 2800);
}
