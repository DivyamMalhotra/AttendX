import { mount, delegate } from '../utils/dom.js';
import { loadingBlock, errorState } from '../components/ui.js';

/** Copies each column heading onto its cells so a table can turn into labelled cards on phones (see tables.css). */
function labelTables(root) {
  root.querySelectorAll('table').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!heads.length) return;
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (td.tagName === 'TD' && !td.hasAttribute('colspan')) td.setAttribute('data-label', heads[i] || ''); }));
  });
}

/** Turns '/session/new/:subjectId' style patterns into a matcher returning params or null. */
function matcher(pattern) {
  const keys = [];
  const rx = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return hash => {
    const m = rx.exec(hash);
    return m ? Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) : null;
  };
}

/**
 * Hash router. Each route lazily imports its page module; a page exports
 * `default async function render({ view, params, ctx, refresh })`.
 * Every (re)render happens in a brand new container element, so event listeners a page
 * attaches can never pile up across navigations or refreshes.
 */
export function createRouter({ outlet, routes, defaultRoute, ctx, onChange }) {
  const compiled = routes.map(r => ({ ...r, match: matcher(r.pattern) }));
  let token = 0;
  // tables drawn later (tabs, modals' lists, refreshed panels) are labelled too
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; labelTables(outlet); }); }).observe(outlet, { childList: true, subtree: true });

  async function renderInto(route, params, mine, { showLoading }) {
    const view = document.createElement('div');
    if (showLoading) { mount(view, loadingBlock()); outlet.replaceChildren(view); }
    const again = () => renderInto(route, params, mine, { showLoading: false });
    try {
      const page = await route.load();
      if (mine !== token) return;
      const fresh = document.createElement('div');
      await page.default({ view: fresh, params, ctx, refresh: again });
      if (mine !== token) return;
      outlet.replaceChildren(fresh);
    } catch (err) {
      if (mine !== token) return;
      console.error(err);
      const box = document.createElement('div');
      mount(box, errorState(err.message || 'Unexpected error.'));
      delegate(box, 'click', '[data-retry]', () => renderInto(route, params, mine, { showLoading: true }));
      outlet.replaceChildren(box);
    }
  }

  async function show() {
    const hash = (location.hash || `#${defaultRoute}`).slice(1);
    const found = compiled.map(r => ({ r, params: r.match(hash) })).find(x => x.params);
    if (!found) { location.hash = `#${defaultRoute}`; return; }
    token += 1;
    if (onChange) onChange(found.r);
    await renderInto(found.r, found.params, token, { showLoading: true });
    outlet.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', show);
  return { start: show, navigate: path => { location.hash = `#${path}`; } };
}
