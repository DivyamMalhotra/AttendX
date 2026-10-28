import { html } from '../utils/dom.js';
import { authApi } from '../api/endpoints.js';
import { renderShell } from '../components/shell.js';
import { openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { readForm, requireFields } from '../components/forms.js';
import { createRouter } from './router.js';
import { createCommandPalette } from '../components/command.js';
import { createLive } from './live.js';
import { registerServiceWorker, watchConnection, rememberUser, clearOfflineData } from './pwa.js';
import { bindInstallButton } from './install.js';
import { watchPasswordFields } from '../components/passwordToggle.js';

// Every password field on any page that loads the app shell gets a Show / Hide button.
watchPasswordFields();

export const dashboardFor = role => ({ admin: 'admin.html', hod: 'hod.html', accounts_clerk: 'hod.html', exam_cell: 'hod.html', teacher: 'teacher.html', student: 'student.html', parent: 'parent.html' }[role] || 'index.html');

/** Shown when an administrator has issued a temporary password; cannot be dismissed. */
function forceNewPassword() {
  return new Promise(resolve => {
    const modal = openModal({
      title: 'Choose a new password',
      confirmText: 'Update password',
      dismissable: false,
      body: html`<p class="muted small" style="margin-top:0">Your account uses a temporary password. Set your own password to continue.</p>
        <form>
          <div class="field"><label for="cp0">Current (temporary) password</label><input id="cp0" name="currentPassword" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="cp1">New password</label><input id="cp1" name="newPassword" type="password" autocomplete="new-password" required>
            <div class="field-hint">At least 8 characters, with letters and a number.</div></div>
          <div class="field"><label for="cp2">Repeat new password</label><input id="cp2" name="repeat" type="password" autocomplete="new-password" required></div>
        </form>`,
      onConfirm: async el => {
        const v = readForm(el);
        const missing = requireFields(el, ['currentPassword', 'newPassword', 'repeat']);
        if (missing) { modal.showError(missing); return false; }
        if (v.newPassword !== v.repeat) { modal.showError('The new passwords do not match.'); return false; }
        await authApi.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword });
        toast('Password updated.', 'success');
        resolve();
      }
    });
  });
}

/**
 * Boots one role's single page app: checks the session, draws the shell and starts the router.
 * `roles` lists every base role that may use this app (the console serves admin, hod, accounts_clerk and exam_cell).
 * `nav` may be a function of the signed-in user, so sidebar entries can be filtered by permission.
 * Redirects to the sign-in page when there is no valid session or the role does not match.
 */
export async function startApp({ role, roles, nav, routes, defaultRoute, rootId = 'app' }) {
  registerServiceWorker();
  watchConnection();
  let me;
  try {
    me = await authApi.me();
  } catch (err) {
    if (err.status === 401) { location.replace('login.html'); return; }
    document.getElementById(rootId).textContent = err.message;
    return;
  }
  const allowed = roles || [role];
  if (!allowed.includes(me.user.role)) { location.replace(dashboardFor(me.user.role)); return; }
  rememberUser(me.user.id);

  window.addEventListener('session-expired', () => { clearOfflineData().finally(() => location.replace('login.html?expired=1')); });
  const live = createLive();
  const navItems = typeof nav === 'function' ? nav(me.user) : nav;
  const keys = new Set(navItems.flatMap(g => g.items.map(i => i.key)));
  const bellRoute = keys.has('notifications') ? 'notifications' : keys.has('announcements') ? 'announcements' : null;
  const signOut = async () => {
    live.stop();
    try { await authApi.logout(); } finally { await clearOfflineData(); location.replace('login.html'); }
  };
  let palette = null;
  const shell = renderShell(document.getElementById(rootId), { user: me.user, nav: navItems, bellRoute, onSignOut: signOut, onOpenCommand: () => palette && palette.open() });
  palette = createCommandPalette({ user: me.user, nav: navItems, navigate: path => { location.hash = `#${path}`; }, onSignOut: signOut });
  bindInstallButton(document.getElementById('installBtn'));   // the button exists only in the student header

  const ctx = {
    user: me.user, settings: me.settings, timeSlots: me.timeSlots, shell, live,
    navigate: path => { location.hash = `#${path}`; }
  };
  const visible = typeof nav === 'function' ? routes.filter(r => r.redirect || ((!r.perms || r.perms.some(p => me.user.permissions && me.user.permissions.includes(p))) && (!r.allow || r.allow(me.user)))) : routes;
  const router = createRouter({ outlet: shell.outlet, routes: visible, defaultRoute: typeof defaultRoute === 'function' ? defaultRoute(me.user) : defaultRoute, ctx, onChange: r => { live.reset(); shell.setActive(r.nav); } });
  if (me.user.mustChangePassword) await forceNewPassword();
  router.start();
  live.start();
  return ctx;
}
