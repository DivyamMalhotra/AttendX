import { html, mount } from '../../utils/dom.js';
import { parentApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';

export default async function render({ view }) {
  const kids = await parentApi.children();
  mount(view, html`${pageHeader('My children', 'You can view, but not change, what the college shares with you.')}
    ${kids.length ? kids.map(k => html`<div class="card card-pad" style="margin-bottom:12px"><div class="flex-between wrap">
      <div><div class="strong">${k.name}</div><div class="small muted">${k.rollNo} · ${k.section ? `${k.section.name} · ${k.section.sem}` : ''} · ${k.relationship}</div></div>
      <a class="btn btn-primary btn-sm" href="#child/${k.id}">View</a></div></div>`)
      : html`<div class="card">${emptyState('No student is linked to your account. Contact the college office.')}</div>`}`);
}
