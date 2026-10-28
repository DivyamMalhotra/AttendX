import { html, mount, delegate } from '../../utils/dom.js';
import { parentApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { chooseChild } from '../../services/childScope.js';

/** The children this parent is verified for. Choosing one points Results and Fees at that child. */
export default async function render({ view }) {
  const children = await parentApi.children();
  mount(view, html`
    ${pageHeader('My children', 'You can see published results and pay fees for the students the college has linked to your account.')}
    ${children.length ? html`<div class="rows">${children.map(c => html`<div class="row-item">
      <div><div class="title">${c.name}</div><div class="meta">${c.rollNo} · ${c.section} · ${c.relationship}</div></div>
      <div class="flex gap-8"><button type="button" class="btn btn-outline btn-sm" data-go="results" data-id="${c.studentId}">Results</button>
        <button type="button" class="btn btn-primary btn-sm" data-go="fees" data-id="${c.studentId}">Fees</button></div></div>`)}</div>`
      : html`<div class="card">${emptyState('No student is linked to your account yet. Please contact the college office.')}</div>`}`);
  delegate(view, 'click', '[data-go]', (e, b) => { chooseChild(b.dataset.id); location.hash = `#${b.dataset.go}`; });
}
