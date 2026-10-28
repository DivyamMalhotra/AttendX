import { html, mount, $, $$, delegate } from '../utils/dom.js';
import { initials } from '../utils/format.js';
import { icons } from './icons.js';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

/**
 * The application frame. There is no sidebar: a single header carries the wordmark, the workspace tabs, the command
 * launcher, notifications and the profile; the active workspace's own destinations sit in a contextual row beneath it.
 * On phones the header shrinks to wordmark + actions and the workspaces move to a bottom bar.
 *
 * nav: [{ section, items: [{ key, route, label, icon }] }]; every group is one workspace.
 */
export function renderShell(root, { user, nav, onSignOut, bellRoute, onOpenCommand }) {
  const workspaces = nav.map((g, i) => ({ id: `w${i}`, name: g.section || 'Workspace', items: g.items }));
  const home = key => workspaces.find(w => w.items.some(i => i.key === key));
  const first = w => w.items[0].route;
  const wsIcon = w => icons[w.items[0].icon] || icons.grid;

  mount(root, html`
    <a class="skip-link" href="#mainContent">Skip to content</a>
    <header class="hdr" id="hdr">
      <div class="hdr-in">
        <a class="wordmark" href="#${first(workspaces[0])}" aria-label="AttendX home"><span class="brand-mark">${icons.logo}</span><span class="wm-text">AttendX</span></a>
        <div class="switcher" id="switcher">
          <button type="button" class="switch-btn" id="switchBtn" aria-haspopup="menu" aria-expanded="false"><span class="switch-label" id="switchLabel">${workspaces[0].name}</span>${icons.chevron}</button>
          <div class="menu hidden" id="switchMenu" role="menu" aria-label="Workspaces">
            <div class="menu-head"><div class="strong">${user.collegeName}</div><div class="small muted">Switch workspace</div></div>
            ${workspaces.map(w => html`<a class="menu-item" role="menuitem" href="#${first(w)}" data-ws="${w.id}">${wsIcon(w)}<span>${w.name}</span><span class="menu-sub">${w.items.length}</span></a>`)}
          </div>
        </div>
        <nav class="ws-tabs" aria-label="Workspaces">${workspaces.map(w => html`<a class="ws-tab" href="#${first(w)}" data-ws="${w.id}">${w.name}<span class="tab-dot hidden" data-wsdot="${w.id}"></span></a>`)}</nav>
        <div class="hdr-actions">
          <button type="button" class="cmd-trigger" id="cmdBtn" aria-label="Open command search" aria-keyshortcuts="Control+K Meta+K">${icons.search}<span class="cmd-text">Search or jump to…</span><kbd>${SHORTCUT}</kbd></button>
          ${user.role === 'student' ? html`<button type="button" class="install-btn hidden" id="installBtn" title="Install AttendX on this device" aria-label="Install the AttendX app">${icons.download}<span>Install app</span></button>` : ''}
          ${bellRoute ? html`<a class="icon-btn bell" href="#${bellRoute}" aria-label="Notifications">${icons.bell}<span class="bell-count hidden" id="bellCount"></span></a>` : ''}
          <div class="profile">
            <button type="button" class="profile-btn" id="profileBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">
              <span class="avatar" aria-hidden="true">${initials(user.name)}</span>
              <span class="profile-text"><span class="profile-name">${user.name}</span><span class="profile-role">${user.title}</span></span>
            </button>
            <div class="menu hidden" id="profileMenu" role="menu">
              <div class="menu-head"><div class="strong">${user.name}</div><div class="small muted">${user.email}</div><div class="small muted">${user.title} · ${user.collegeName}</div></div>
              <button type="button" class="menu-item" role="menuitem" id="cmdItem">${icons.search}<span>Command search</span><kbd>${SHORTCUT}</kbd></button>
              <button type="button" class="menu-item" role="menuitem" id="signOutBtn">${icons.signout}<span>Sign out</span></button>
            </div>
          </div>
        </div>
      </div>
      <nav class="subnav" id="subnav" aria-label="Section"></nav>
    </header>
    <main class="main" id="mainContent" tabindex="-1"></main>
    <nav class="bottom-nav" id="bottomNav" aria-label="Workspaces">
      ${workspaces.slice(0, 4).map(w => html`<a class="bn-item" href="#${first(w)}" data-ws="${w.id}">${wsIcon(w)}<span>${w.name}</span></a>`)}
      ${workspaces.length > 4 ? html`<button type="button" class="bn-item" id="bnMore" aria-haspopup="dialog">${icons.menu}<span>More</span></button>` : ''}
    </nav>
    <div class="sheet-scrim hidden" id="sheetScrim"></div>
    <div class="sheet hidden" id="moreSheet" role="dialog" aria-modal="true" aria-label="More workspaces">
      <div class="sheet-grip" aria-hidden="true"></div>
      ${workspaces.slice(4).map(w => html`<div class="sheet-group"><div class="nav-section-label">${w.name}</div>${w.items.map(i => html`<a class="sheet-link" href="#${i.route}">${icons[i.icon]}<span>${i.label}</span></a>`)}</div>`)}
    </div>`);

  /* ---- menus (switcher + profile) ---- */
  const menus = [['#switchBtn', '#switchMenu'], ['#profileBtn', '#profileMenu']].map(([b, m]) => ({ btn: $(b, root), menu: $(m, root) }));
  const closeMenus = () => menus.forEach(({ btn, menu }) => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); });
  menus.forEach(({ btn, menu }) => btn.addEventListener('click', e => {
    e.stopPropagation(); const open = menu.classList.contains('hidden'); closeMenus();
    menu.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', String(open));
    if (open) $('.menu-item', menu)?.focus();
  }));
  document.addEventListener('click', e => { if (!e.target.closest('.menu, .switch-btn, .profile-btn')) closeMenus(); });
  delegate($('#switchMenu', root), 'click', '.menu-item', closeMenus);
  $('#signOutBtn', root).addEventListener('click', onSignOut);
  const openCmd = () => { closeMenus(); onOpenCommand && onOpenCommand(); };
  $('#cmdBtn', root).addEventListener('click', openCmd);
  $('#cmdItem', root).addEventListener('click', openCmd);

  /* ---- mobile "more" sheet ---- */
  const sheet = $('#moreSheet', root); const scrim = $('#sheetScrim', root);
  const setSheet = open => { sheet.classList.toggle('hidden', !open); scrim.classList.toggle('hidden', !open); document.body.classList.toggle('no-scroll', open); if (open) $('.sheet-link', sheet)?.focus(); };
  $('#bnMore', root)?.addEventListener('click', () => setSheet(true));
  scrim.addEventListener('click', () => setSheet(false));
  delegate(sheet, 'click', '.sheet-link', () => setSheet(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenus(); setSheet(false); } });

  const counts = new Map();
  const paintBell = () => {
    const el = $('#bellCount', root); if (!el) return;
    const n = (counts.get('notifications') || 0) + (counts.get('announcements') || 0);
    el.textContent = n > 99 ? '99+' : String(n); el.classList.toggle('hidden', !n);
  };

  function paintSubnav(ws, activeKey) {
    mount($('#subnav', root), ws.items.length > 1 ? html`<div class="subnav-in">${ws.items.map(i => html`<a class="sub-link ${i.key === activeKey ? 'active' : ''}" href="#${i.route}" data-nav="${i.key}" ${i.key === activeKey ? html`aria-current="page"` : ''}>${i.label}<span class="nav-count hidden" data-badge="${i.key}"></span></a>`)}</div>` : '');
    ws.items.forEach(i => { const n = counts.get(i.key); const el = $(`[data-badge="${i.key}"]`, root); if (el && n) { el.textContent = n > 99 ? '99+' : String(n); el.classList.remove('hidden'); } });
    $('#hdr', root).classList.toggle('has-sub', ws.items.length > 1);
  }

  return {
    outlet: $('#mainContent', root),
    setActive(key) {
      const ws = home(key) || workspaces[0];
      $$('[data-ws]', root).forEach(a => { const on = a.dataset.ws === ws.id; a.classList.toggle('active', on); if (a.classList.contains('ws-tab') || a.classList.contains('bn-item')) { if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); } });
      $('#switchLabel', root).textContent = ws.name;
      $('#bnMore', root)?.classList.toggle('active', workspaces.indexOf(ws) >= 4);
      paintSubnav(ws, key);
      const item = ws.items.find(i => i.key === key);
      if (item) document.title = `${item.label} — AttendX`;
    },
    setBadge(key, count) {
      counts.set(key, count);
      const el = $(`[data-badge="${key}"]`, root);
      if (el) { el.textContent = count > 99 ? '99+' : String(count); el.classList.toggle('hidden', !count); }
      paintBell();
    }
  };
}
