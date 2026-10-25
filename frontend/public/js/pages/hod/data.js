import { html, mount, delegate } from '../../utils/dom.js';
import { dataApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, statusPill, act, can, card, formModal, confirmThen } from '../../components/kit.js';
import { openModal } from '../../components/modal.js';
import { examsApi } from '../../api/phase2.js';
import { formatDateTime, cap } from '../../utils/format.js';

const KINDS = [['students', 'Students', 'students.manage'], ['books', 'Library books', 'library.manage'], ['marks', 'Examination marks', 'marks.enter']];
const EXPORTS = [['students', 'Students', 'students.view'], ['fees', 'Fees', 'fees.view'], ['payments', 'Payments', 'payments.view'], ['loans', 'Library loans', 'library.manage']];

export default async function render({ view, ctx, refresh }) {
  const importer = can(ctx, 'imports.manage');
  const [batches] = await Promise.all([importer ? dataApi.imports() : []]);

  mount(view, html`
    ${pageHeader('Import & export', 'Imports are checked first; nothing changes until you confirm the preview.')}
    ${importer ? card('Import from CSV', html`<div class="flex gap-8 wrap">${KINDS.filter(k => can(ctx, k[2])).map(([key, label]) => html`
      <div class="card card-pad" style="min-width:210px"><div class="strong">${label}</div>
        <button class="btn btn-outline btn-sm mt-8" data-tpl="${key}">Download template</button>
        <button class="btn btn-primary btn-sm mt-8" data-up="${key}">Upload file</button></div>`)}</div>`) : ''}
    ${can(ctx, 'reports.export') ? card('Export to CSV', html`<div class="flex gap-8 wrap">${EXPORTS.filter(x => can(ctx, x[2]) && !(ctx.user.role === 'hod' && ['fees', 'payments'].includes(x[0]))).map(([key, label]) => html`<button class="btn btn-outline" data-exp="${key}">${label}</button>`)}</div>
      <p class="small muted">Exports are recorded in the audit log. Cells that could run as spreadsheet formulas are exported as plain text.</p>`) : ''}
    ${importer ? card('Recent imports', dataTable([
      { label: 'When', render: b => formatDateTime(b.createdAt) }, { label: 'Type', render: b => cap(b.kind) }, { label: 'File', render: b => b.fileName },
      { label: 'Rows', cls: 'right', render: b => `${b.totals.valid}/${b.totals.rows} valid` }, { label: 'Status', render: b => statusPill(b.status) },
      { label: '', cls: 'right', render: b => (b.status === 'previewed' ? html`<button class="btn btn-outline btn-sm" data-open="${b.id}">Review</button>` : '') }
    ], batches, { empty: 'No imports yet.' })) : ''}`);

  delegate(view, 'click', '[data-tpl]', (e, b) => act(() => dataApi.template(b.dataset.tpl)));
  delegate(view, 'click', '[data-exp]', (e, b) => act(() => dataApi.exportCsv(b.dataset.exp)));
  delegate(view, 'click', '[data-open]', async (e, b) => review(await dataApi.batch(b.dataset.open), refresh));
  delegate(view, 'click', '[data-up]', async (e, b) => {
    const kind = b.dataset.up;
    const exams = kind === 'marks' ? (await examsApi.list({})).filter(x => ['draft', 'marks_entry'].includes(x.status)) : [];
    formModal({
      title: `Upload ${kind} CSV`, submit: 'Check file',
      fields: [
        ...(kind === 'marks' ? [{ name: 'examId', type: 'select', label: 'Examination', required: true, options: exams.map(x => ({ value: x._id, label: `${x.name} · ${x.subject ? x.subject.name : ''}` })) }] : []),
        { name: 'file', type: 'file', label: 'CSV file (up to 1 MB, 2000 rows)', required: true, accept: '.csv,text/csv' }
      ],
      async onSubmit(v) {
        if (!v.file) throw new Error('Choose a CSV file.');
        const form = new FormData();
        if (v.examId) form.append('examId', v.examId);
        form.append('file', v.file, v.file.name);
        review(await dataApi.preview(kind, form), refresh);
      }
    });
  });
}

function review(p, refresh) {
  openModal({
    title: `Preview: ${p.fileName || p.kind}`, wide: true, confirmText: p.totals.valid ? (p.totals.invalid ? 'Import valid rows only' : 'Confirm import') : 'Close',
    body: html`<p class="muted small" style="margin-top:0">${p.totals.rows} rows · ${p.totals.valid} valid · ${p.totals.invalid} with problems. Nothing has been imported yet.</p>
      ${p.errors.length ? html`<div class="notice notice-warning"><div><div class="notice-title">Problems found${p.errors.length > 20 ? ' (first 20 shown)' : ''}</div>
        ${p.errors.slice(0, 20).map(e => html`<div class="small">Line ${e.line}: ${e.errors.join(' ')}</div>`)}</div></div>` : ''}`,
    async onConfirm() {
      if (!p.totals.valid) return true;
      const done = await dataApi.confirm(p.id, p.totals.invalid > 0);
      openModal({
        title: 'Import finished', confirmText: 'Close', onConfirm: () => true,
        body: html`<p>${done.totals.ok} imported · ${done.totals.skipped} skipped · ${done.totals.failed} failed.</p>
          ${done.extras && done.extras.welcomeRequested ? html`<p class="small muted">${done.extras.welcomeRequested} new students were sent a set-your-password email (only if email is configured).</p>` : ''}
          ${(done.failures || []).map(f => html`<div class="small">Line ${f.line}: ${f.message}</div>`)}`
      });
      refresh();
    }
  });
}
