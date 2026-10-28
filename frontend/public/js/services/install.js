/**
 * "Install app" support, shared by the public sign-in page and the signed-in student interface.
 *
 * The browser decides whether AttendX can be installed and tells the page by firing `beforeinstallprompt` (Chromium
 * browsers: Chrome, Edge, Samsung Internet; not Safari or Firefox). This module:
 *  - listens for that event once per page (and keeps the event so the button can use it later),
 *  - shows a button only while an install prompt really exists and the user has not dismissed it in this tab session,
 *  - calls the stored prompt when the button is clicked and waits for the user's choice,
 *  - hides the button after the user accepts or declines, and when the browser reports `appinstalled`.
 * In browsers that never fire the event nothing is shown: there is no button that could do nothing.
 */
const DISMISSED_KEY = 'attendx.install.dismissed';   // sessionStorage: remembered for this tab, forgotten when it closes

let deferred = null;       // the browser's install prompt, once offered
let installed = false;
let started = false;
const listeners = new Set();

const wasDismissed = () => { try { return sessionStorage.getItem(DISMISSED_KEY) === '1'; } catch (e) { return false; } };
const rememberDismissal = () => { try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch (e) { /* the button just reappears on the next page load */ } };
const snapshot = () => ({ available: Boolean(deferred) && !installed && !wasDismissed() });
const notify = () => listeners.forEach(fn => fn(snapshot()));

export function initInstall() {
  if (started) return;
  started = true;
  // Already running as an installed app: nothing to offer.
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) installed = true;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();          // we show our own button instead of the browser's mini-bar
    deferred = event;
    notify();
  });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; notify(); });
}

/** Calls fn now and whenever availability changes. Returns an unsubscribe function. */
export function onInstallChange(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

/** Shows the browser's install dialog. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const prompt = deferred;
  deferred = null;                   // a prompt can be used only once
  notify();
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome !== 'accepted') { rememberDismissal(); notify(); }
    return outcome;
  } catch (err) {
    rememberDismissal(); notify();
    return 'dismissed';
  }
}

/** Wires one button element (idempotent: calling it twice for the same button adds nothing). */
export function bindInstallButton(button) {
  if (!button || button.dataset.installBound) return;
  button.dataset.installBound = '1';
  button.addEventListener('click', () => { promptInstall(); });
  onInstallChange(state => button.classList.toggle('hidden', !state.available));
}

initInstall();   // register the listener as early as possible: the browser may fire the event soon after load
