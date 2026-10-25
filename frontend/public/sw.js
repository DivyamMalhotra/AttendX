/*
 * AttendX service worker.
 *
 *  - The app shell (pages, scripts, styles) is fetched network-first and kept as a fallback, so the app opens offline
 *    after one online visit.
 *  - A small allow-list of READ-ONLY API responses (the signed-in person's own attendance, dashboard, timetable and
 *    profile) is kept for offline viewing. Nothing financial, medical, or related to results or messages is ever
 *    cached, and no write is ever queued or replayed: offline you can look, not change.
 *  - The saved copy is wiped on sign-out and whenever a different person signs in (see js/services/pwa.js).
 */
const VERSION = 'v1';
const STATIC = `attendx-static-${VERSION}`;
const DATA = 'attendx-data-v1';
const OFFLINE_URL = '/offline.html';

const DATA_PATHS = [
  /^\/api\/auth\/me$/,
  /^\/api\/student\/attendance$/,
  /^\/api\/student\/dashboard$/,
  /^\/api\/student\/timetable$/
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(c => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC, DATA]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'clear-data') event.waitUntil(caches.delete(DATA));
});

const withHeaders = async (response, extra) => {
  const headers = new Headers(response.headers);
  Object.entries(extra).forEach(([k, v]) => headers.set(k, v));
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
};

async function networkFirst(request, cacheName, { markStale = false } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      cache.put(request, await withHeaders(response.clone(), { 'x-cached-at': new Date().toISOString() })).catch(() => {});
    }
    return response;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: !markStale });
    if (!hit) throw err;
    return markStale ? withHeaders(hit, { 'x-from-cache': '1' }) : hit;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (DATA_PATHS.some(rx => rx.test(url.pathname))) event.respondWith(networkFirst(request, DATA, { markStale: true }));
    return;   // every other API call goes straight to the network and is never stored
  }
  if (url.pathname.startsWith('/ready') || url.pathname.startsWith('/health')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }
  event.respondWith(networkFirst(request, STATIC));
});
