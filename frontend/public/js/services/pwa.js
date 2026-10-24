/**
 * Progressive-web-app glue: registers the service worker, shows an offline / "saved copy" banner and an install
 * button, and wipes the offline copy whenever someone signs out or a different person signs in on the device.
 */
const USER_KEY = 'attendx.lastUser';

const safe = fn => { try { return fn(); } catch (e) { return null; } };

export async function clearOfflineData() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const target = (reg && (reg.active || reg.waiting)) || navigator.serviceWorker.controller;
  if (target) target.postMessage({ type: 'clear-data' });
  if (window.caches) { try { await caches.delete('attendx-data-v1'); } catch (e) { /* the worker message above is the main path */ } }
}

/** Call after /auth/me: if a different person is now signed in on this browser, forget the previous person's saved data. */
export function rememberUser(userId) {
  const prev = safe(() => localStorage.getItem(USER_KEY));
  if (prev && prev !== userId) clearOfflineData();
  safe(() => localStorage.setItem(USER_KEY, userId));
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => console.warn('service worker not registered', err)));
}

function banner() {
  let el = document.getElementById('offlineBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offlineBanner';
    el.setAttribute('role', 'status');
    el.className = 'notice notice-warning';
    el.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:50;max-width:92vw;display:none';
    document.body.appendChild(el);
  }
  return el;
}

/** Shows what the user is looking at when the network is gone or the answer came from the saved copy. */
export function watchConnection() {
  const el = banner();
  const show = text => { el.textContent = text; el.style.display = 'block'; };
  const hide = () => { el.style.display = 'none'; };
  if (!navigator.onLine) show('You are offline. You can view saved attendance; changes cannot be made until you reconnect.');
  window.addEventListener('offline', () => show('You are offline. You can view saved attendance; changes cannot be made until you reconnect.'));
  window.addEventListener('online', hide);
  window.addEventListener('attendx:stale', e => show(`Showing a saved copy from ${new Date(e.detail.cachedAt).toLocaleString('en-IN')}. Reconnect for the latest.`));
  window.addEventListener('attendx:fresh', hide);
}

let deferred = null;
/** Shows the header's "Install app" button only when the browser says the app can be installed. */
export function installPrompt(button) {
  if (!button) return;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    button.classList.remove('hidden');
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    button.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => button.classList.add('hidden'));
}
