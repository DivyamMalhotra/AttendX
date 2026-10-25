/**
 * The only module that talks to the network. It owns CSRF handling and error normalization,
 * so page code never builds headers or parses error bodies itself.
 * Authentication lives in an HttpOnly session cookie that this code cannot read.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = null;
let staleShown = false;
export const setCsrfToken = token => { csrfToken = token; };

async function fetchCsrfToken() {
  const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  csrfToken = (await res.json()).data.csrfToken;
  return csrfToken;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function buildUrl(url, query) {
  if (!query) return url;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params.set(k, v); });
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function send(method, url, { body, query, form } = {}, retried = false) {
  const headers = { Accept: 'application/json' };
  const init = { method, credentials: 'same-origin', headers };
  if (UNSAFE.has(method)) {
    headers['X-CSRF-Token'] = csrfToken || await fetchCsrfToken();
  }
  if (form) init.body = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(buildUrl(url, query), init);
  } catch (e) {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  // The service worker marks answers it served from its saved copy (offline viewing); tell the page so it can say so.
  const cachedAt = res.headers.get('x-from-cache') ? res.headers.get('x-cached-at') : null;
  if (cachedAt) { staleShown = true; window.dispatchEvent(new CustomEvent('attendx:stale', { detail: { cachedAt } })); }
  else if (staleShown && res.ok) { staleShown = false; window.dispatchEvent(new CustomEvent('attendx:fresh')); }
  return { res, retry: () => send(method, url, { body, query, form }, true), retried };
}

async function parse({ res, retry, retried }) {
  const type = res.headers.get('content-type') || '';
  if (res.ok) {
    if (type.includes('application/json')) return res.json();
    return res;
  }
  const payload = type.includes('application/json') ? await res.json().catch(() => ({})) : {};
  const err = payload.error || {};
  if (res.status === 403 && err.code === 'CSRF_INVALID' && !retried) {
    await fetchCsrfToken();
    return parse(await retry());
  }
  if (res.status === 401 && err.code !== 'INVALID_CREDENTIALS') window.dispatchEvent(new CustomEvent('session-expired'));
  throw new ApiError(res.status, err.code || 'ERROR', err.message || 'Something went wrong. Please try again.', err.details);
}

const call = async (method, url, opts) => parse(await send(method, url, opts));

/** Returns the `data` field; use getPage for list endpoints that also return `meta`. */
export const api = {
  get: async (url, query) => (await call('GET', url, { query })).data,
  getPage: async (url, query) => { const r = await call('GET', url, { query }); return { rows: r.data, meta: r.meta || {} }; },
  post: async (url, body) => (await call('POST', url, { body })).data,
  put: async (url, body) => (await call('PUT', url, { body })).data,
  patch: async (url, body) => (await call('PATCH', url, { body })).data,
  del: async url => (await call('DELETE', url)).data,
  upload: async (url, formData) => (await call('POST', url, { form: formData })).data
};

/** Downloads a file (PDF receipt, CSV export, uploaded document) through the authenticated session. */
export async function download(url, fallbackName, query) {
  const res = await call('GET', url, { query });
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
