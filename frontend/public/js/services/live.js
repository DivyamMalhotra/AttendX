/**
 * Live updates over Server-Sent Events (/api/events). The stream only carries ids and generic types, never message
 * text or personal data: a page that hears something re-reads the real data through the normal, permission-checked
 * API. The app works without it; if the connection drops the browser retries and resumes from the last event id.
 *
 * Pages register interest with ctx.live.on(type, fn); registrations are dropped whenever the route changes.
 */
const TYPES = ['notification', 'payment.updated', 'refund.updated', 'qr.scan'];

export function createLive() {
  let source = null;
  const global = new Map();     // handlers that live for the whole session
  let pageHandlers = new Map(); // handlers that die with the current page

  const add = (map, type, fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); };
  const fire = (type, detail) => {
    [global.get(type), pageHandlers.get(type)].forEach(set => set && set.forEach(fn => { try { fn(detail); } catch (e) { console.error(e); } }));
  };

  return {
    /** Session-wide listener (shell badges, toasts). */
    always: (type, fn) => add(global, type, fn),
    /** Page-scoped listener, cleared by reset() on navigation. */
    on: (type, fn) => add(pageHandlers, type, fn),
    reset() { pageHandlers = new Map(); },
    start() {
      if (source || typeof EventSource === 'undefined') return;
      source = new EventSource('/api/events');
      TYPES.forEach(type => source.addEventListener(type, e => {
        let detail = {};
        try { detail = JSON.parse(e.data); } catch (err) { /* keep-alive or malformed: ignore */ }
        fire(type, detail);
      }));
    },
    stop() { if (source) { source.close(); source = null; } }
  };
}
