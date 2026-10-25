import { html, mount, delegate } from '../../utils/dom.js';
import { courseworkApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { dataTable, badge, act } from '../../components/kit.js';
import { formatDate } from '../../utils/format.js';

const TYPES = { lecture_notes: 'Lecture notes', slides: 'Slides', reference: 'Reference', question_paper: 'Question paper', other: 'Other' };
const size = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function render({ view }) {
  const rows = await courseworkApi.myMaterials();
  mount(view, html`
    ${pageHeader('Study material', 'Notes, slides and papers shared by your teachers.')}
    ${rows.length ? dataTable([
      { label: 'Title', render: r => html`<span class="cell-strong">${r.title}</span>${r.topic ? html`<div class="small muted">${r.topic}</div>` : ''}` },
      { label: 'Subject', render: r => r.subject ? r.subject.name : '' },
      { label: 'Type', render: r => badge('gray', TYPES[r.resourceType] || 'Other') },
      { label: 'Added', render: r => formatDate(r.createdAt) },
      { label: 'File', render: r => html`<button type="button" class="btn btn-outline btn-sm" data-dl="${r.id}" data-name="${r.fileName}">Download</button> <span class="small faint">${size(r.size)}</span>` }
    ], rows) : html`<div class="card">${emptyState('No study material has been shared yet.')}</div>`}`);
  delegate(view, 'click', '[data-dl]', (e, b) => act(() => courseworkApi.file('material', b.dataset.dl, 0, b.dataset.name)));
}
