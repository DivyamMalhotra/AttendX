import { html, mount, $, $$, debounce } from '../utils/dom.js';
import { icons } from './icons.js';
import { adminApi, facultyApi } from '../api/endpoints.js';

/**
 * Command palette (Ctrl/Cmd + K). It offers exactly what this person can do:
 *  - every page in the navigation they were given (so permissions are respected automatically),
 *  - account actions (sign out),
 *  - live search of students and subjects where their role may search them, using the same API calls as those pages.
 * Search results open the real page for that record; nothing here invents data or routes.
 */
export const SEARCH_HANDOFF = { students: 'attendx.q.students' };

const norm = s => String(s || '').toLowerCase();
const score = (cmd, q) => {
  if (!q) return 1;
  const label = norm(cmd.label); const hay = `${label} ${norm(cmd.group)} ${norm(cmd.hint)}`;
  if (label.startsWith(q)) return 4;
  if (label.includes(q)) return 3;
  return q.split(/\s+/).every(w => hay.includes(w)) ? 2 : 0;
};

export function createCommandPalette({ user, nav, navigate, onSignOut }) {
  const can = p => (user.permissions || []).includes(p);
  const pages = nav.flatMap(g => g.items.map(i => ({ id: `go:${i.key}`, type: 'page', group: 'Go to', label: i.label, hint: g.section, icon: i.icon, run: () => navigate(i.route) })));
  const actions = [{ id: 'act:signout', type: 'action', group: 'Account', label: 'Sign out', hint: 'End this session', icon: 'signout', run: onSignOut }];
  const searchStudents = can('students.view') || can('students.manage') || user.role === 'hod';
  let subjectCache = null;
  const subjects = async () => {
    if (subjectCache) return subjectCache;
    if (user.role === 'teacher') subjectCache = (await facultyApi.subjects()).map(s => ({ id: s.id, name: s.name, where: `${s.section.name} · ${s.section.sem}`, route: `summary/${s.id}` }));
    else if (can('roster.manage') || searchStudents) subjectCache = (await adminApi.sections()).flatMap(s => (s.subjects || []).map(x => ({ id: x._id, name: x.name, where: `${s.name} · ${s.sem}`, route: 'sections' })));
    else subjectCache = [];
    return subjectCache;
  };

  let overlay = null; let input; let list; let state = { q: '', items: [], active: 0, remote: [] }; let prevFocus = null; let seq = 0;

  function build() {
    const q = norm(state.q.trim());
    const local = [...pages, ...actions].map(c => ({ c, s: score(c, q) })).filter(x => x.s).sort((a, b) => b.s - a.s).map(x => x.c).slice(0, q ? 8 : 12);
    state.items = [...local, ...state.remote];
    state.active = Math.min(state.active, Math.max(0, state.items.length - 1));
    const groups = [];
    state.items.forEach((c, i) => { let g = groups.find(x => x.name === c.group); if (!g) { g = { name: c.group, rows: [] }; groups.push(g); } g.rows.push({ c, i }); });
    mount(list, groups.length ? groups.map(g => html`<div role="group" aria-label="${g.name}"><div class="cmd-group">${g.name}</div>
      ${g.rows.map(({ c, i }) => html`<div class="cmd-item ${i === state.active ? 'active' : ''}" role="option" id="cmd-${i}" aria-selected="${i === state.active}" data-i="${i}">${icons[c.icon] || icons.search}<span class="cmd-label">${c.label}</span>${c.hint ? html`<span class="cmd-hint">${c.hint}</span>` : ''}</div>`)}</div>`)
      : html`<div class="cmd-empty">No match for “${state.q}”.</div>`);
    input.setAttribute('aria-activedescendant', state.items.length ? `cmd-${state.active}` : '');
    $('.cmd-item.active', list)?.scrollIntoView({ block: 'nearest' });
  }

  const remoteSearch = debounce(async text => {
    const mine = ++seq; const q = text.trim();
    if (q.length < 2) { state.remote = []; return build(); }
    const out = [];
    try {
      if (searchStudents) {
        const { rows } = await adminApi.students({ q, limit: 5 });
        rows.forEach(s => out.push({ id: `stu:${s.id}`, type: 'student', group: 'Students', label: s.name, hint: `${s.rollNo}${s.section ? ` · ${s.section.name}` : ''}`, icon: 'user', run: () => { try { sessionStorage.setItem(SEARCH_HANDOFF.students, s.rollNo); } catch (e) { /* the page just opens unfiltered */ } navigate('students'); } }));
      }
      const subs = await subjects();
      subs.filter(s => norm(s.name).includes(norm(q))).slice(0, 4).forEach(s => out.push({ id: `sub:${s.id}`, type: 'subject', group: 'Subjects', label: s.name, hint: s.where, icon: 'classes', run: () => navigate(s.route) }));
    } catch (err) { /* a failed lookup only hides the extra results; pages still work */ }
    if (mine !== seq) return;
    state.remote = out; build();
  }, 220);

  function close() {
    if (!overlay) return;
    overlay.remove(); overlay = null; document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  function choose(i) { const c = state.items[i]; if (!c) return; close(); c.run(); }

  function onKey(e) {
    if (!overlay) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); state.active = (state.active + 1) % Math.max(1, state.items.length); build(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.active = (state.active - 1 + state.items.length) % Math.max(1, state.items.length); build(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(state.active); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  }

  function open() {
    if (overlay) return;
    prevFocus = document.activeElement;
    state = { q: '', items: [], active: 0, remote: [] };
    overlay = document.createElement('div');
    overlay.className = 'cmd-overlay';
    mount(overlay, html`<div class="cmd" role="dialog" aria-modal="true" aria-label="Command search">
      <div class="cmd-field">${icons.search}<input id="cmdInput" type="text" role="combobox" aria-expanded="true" aria-controls="cmdList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search pages${searchStudents ? ', students' : ''}${user.role === 'teacher' || searchStudents ? ' and subjects' : ''}…"><kbd>Esc</kbd></div>
      <div class="cmd-list" id="cmdList" role="listbox" aria-label="Results"></div>
      <div class="cmd-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div></div>`);
    document.body.appendChild(overlay); document.body.classList.add('no-scroll');
    input = $('#cmdInput', overlay); list = $('#cmdList', overlay);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    list.addEventListener('click', e => { const el = e.target.closest('[data-i]'); if (el) choose(Number(el.dataset.i)); });
    list.addEventListener('mousemove', e => { const el = e.target.closest('[data-i]'); if (el && Number(el.dataset.i) !== state.active) { state.active = Number(el.dataset.i); $$('.cmd-item', list).forEach((n, k) => { n.classList.toggle('active', k === state.active); n.setAttribute('aria-selected', String(k === state.active)); }); } });
    input.addEventListener('input', () => { state.q = input.value; state.active = 0; build(); remoteSearch(input.value); });
    document.addEventListener('keydown', onKey, true);
    build(); input.focus();
  }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); overlay ? close() : open(); }
    else if (e.key === '/' && !overlay && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); open(); }
  });
  return { open, close };
}
