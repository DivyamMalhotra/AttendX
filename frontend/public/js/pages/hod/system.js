import { html, mount, delegate } from '../../utils/dom.js';
import { systemApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, statusPill, act, can, card } from '../../components/kit.js';
import { formatDateTime } from '../../utils/format.js';

const size = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function render({ view, ctx, refresh }) {
  const [jobs, backups] = await Promise.all([
    can(ctx, 'system.health', 'system.jobs') ? systemApi.jobs() : [],
    can(ctx, 'system.backup', 'system.health') ? systemApi.backups() : []
  ]);
  mount(view, html`
    ${pageHeader('Jobs & backups', 'Background work and data protection.')}
    ${jobs.length ? card('Background jobs', dataTable([
      { label: 'Job', render: j => j.name }, { label: 'Every', render: j => `${j.intervalMin} min` },
      { label: 'Last run', render: j => (j.last ? formatDateTime(j.last.startedAt) : 'never') },
      { label: 'Result', render: j => (j.last ? html`${statusPill(j.last.status)}${j.last.error ? html`<div class="small text-red">${j.last.error}</div>` : ''}` : '—') },
      { label: '', cls: 'right', render: j => (can(ctx, 'system.jobs') ? html`<button class="btn btn-outline btn-sm" data-job="${j.name}">Run now</button>` : '') }
    ], jobs)) : ''}
    ${can(ctx, 'system.backup', 'system.health') ? card('Backups', html`
      ${can(ctx, 'system.backup') ? html`<div class="toolbar"><button class="btn btn-primary" id="mk">Back up now</button></div>` : ''}
      ${dataTable([
        { label: 'Started', render: b => formatDateTime(b.startedAt) }, { label: 'Status', render: b => statusPill(b.status) },
        { label: 'Size', render: b => (b.sizeBytes ? size(b.sizeBytes) : '—') }, { label: 'Documents', cls: 'right', render: b => b.documents },
        { label: 'Encrypted', render: b => (b.encrypted ? 'yes' : 'no') }, { label: 'Note', render: b => b.error || (b.file ? '' : 'removed by retention') },
        { label: '', cls: 'right', render: b => (b.file && can(ctx, 'system.backup') ? html`<button class="btn btn-outline btn-sm" data-verify="${b.id}">Verify</button>` : '') }
      ], backups, { empty: 'No backups yet.' })}
      <p class="small muted">Uploaded files are not part of the backup; copy the uploads folder separately. Restore with <code>npm run restore</code> into a new database.</p>`) : ''}`);

  delegate(view, 'click', '[data-job]', (e, b) => act(() => systemApi.runJob(b.dataset.job), { success: 'Job finished.', after: refresh }));
  view.querySelector('#mk')?.addEventListener('click', () => act(() => systemApi.createBackup(), { success: 'Backup created and verified.', after: refresh }));
  delegate(view, 'click', '[data-verify]', (e, b) => act(async () => { const r = await systemApi.verifyBackup(b.dataset.verify); return r; }, { success: 'Backup verified: checksum and contents are intact.' }));
}
