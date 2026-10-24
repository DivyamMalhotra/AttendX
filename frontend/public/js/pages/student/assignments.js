import { html, mount, delegate } from '../../utils/dom.js';
import { courseworkApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { badge, statusPill, formModal, act } from '../../components/kit.js';
import { formatDateTime } from '../../utils/format.js';

const state = (a, now) => {
  if (a.submission) {
    if (a.submission.status === 'returned') return ['amber', 'Returned for revision'];
    if (a.submission.status === 'graded') return ['green', 'Graded'];
    return ['blue', a.submission.late ? 'Submitted late' : 'Submitted'];
  }
  if (a.closed) return ['gray', 'Closed'];
  if (new Date(a.deadline) < now) return a.allowLate ? ['amber', 'Overdue — late allowed'] : ['red', 'Missed'];
  return ['amber', 'To do'];
};

export default async function render({ view, refresh, ctx }) {
  const items = await courseworkApi.mine();
  ctx.live.on('notification', refresh);
  const now = new Date();
  const open = items.filter(a => !a.submission && !a.closed && (new Date(a.deadline) >= now || a.allowLate));
  const rest = items.filter(a => !open.includes(a));

  const card = a => {
    const [tone, label] = state(a, now);
    const canSubmit = !a.closed && (!a.submission ? (new Date(a.deadline) >= now || a.allowLate) : a.allowResubmit && a.submission.status !== 'graded');
    return html`<div class="card card-pad" style="margin-bottom:12px">
      <div class="flex-between wrap"><div><div class="muted small">${a.subject ? a.subject.name : ''}</div><div class="strong">${a.title}</div>
        <div class="small muted">Due ${formatDateTime(a.deadline)} · ${a.maxMarks} marks</div></div>${badge(tone, label)}</div>
      ${a.instructions ? html`<p class="small" style="white-space:pre-wrap">${a.instructions}</p>` : ''}
      ${a.attachments.length ? html`<div class="flex gap-8 wrap">${a.attachments.map(f => html`<button type="button" class="btn btn-outline btn-sm" data-file="assignment:${a.id}:${f.index}:${f.name}">${f.name}</button>`)}</div>` : ''}
      ${a.submission ? html`<div class="small mt-12"><b>Your submission</b> (attempt ${a.submission.attempt}, ${formatDateTime(a.submission.submittedAt)}):
        ${a.submission.files.map(f => html`<button type="button" class="btn-link" data-file="submission:${a.id}:${f.index}:${f.name}">${f.name}</button> `)}
        ${a.submission.marks !== null && a.submission.marks !== undefined ? html`<div class="mt-8"><b>Marks:</b> ${a.submission.marks}/${a.maxMarks}</div>` : ''}
        ${a.submission.feedback ? html`<div class="mt-8"><b>Feedback:</b> ${a.submission.feedback}</div>` : ''}</div>` : ''}
      ${canSubmit ? html`<div class="mt-12"><button type="button" class="btn btn-primary btn-sm" data-submit="${a.id}">${a.submission ? 'Submit a new version' : 'Submit work'}</button></div>` : ''}
    </div>`;
  };

  mount(view, html`
    ${pageHeader('Assignments', 'Work set by your teachers. Marks and feedback appear once your teacher releases them.')}
    ${open.length ? html`<h3 class="card-section-label">To do</h3>${open.map(card)}` : html`<div class="card" style="margin-bottom:16px">${emptyState('Nothing is waiting for you.')}</div>`}
    ${rest.length ? html`<h3 class="card-section-label mt-24">Everything else</h3>${rest.map(card)}` : ''}`);

  delegate(view, 'click', '[data-file]', (e, b) => { const [kind, id, index, ...name] = b.dataset.file.split(':'); act(() => courseworkApi.file(kind, id, index, name.join(':'))); });
  delegate(view, 'click', '[data-submit]', (e, b) => {
    const a = items.find(x => x.id === b.dataset.submit);
    formModal({
      title: `Submit: ${a.title}`, submit: 'Submit',
      intro: a.submission ? 'This replaces your previous version; earlier versions are kept for your teacher.' : (new Date(a.deadline) < new Date() ? 'The deadline has passed. This will be recorded as a late submission.' : ''),
      fields: [{ name: 'files', type: 'file', label: 'Files (PDF, image, Office document or text — up to 3)', required: true, accept: '.pdf,.png,.jpg,.jpeg,.docx,.pptx,.xlsx,.txt' },
        { name: 'note', type: 'textarea', label: 'Note for your teacher', max: 1000 }],
      async onSubmit(v, { el }) {
        const input = el.querySelector('input[type=file]');
        if (!input.files.length) return false;
        const form = new FormData();
        [...input.files].slice(0, 3).forEach(f => form.append('files', f));
        if (v.note) form.append('note', v.note);
        await courseworkApi.submit(a.id, form);
        refresh();
      }
    });
  });
}
