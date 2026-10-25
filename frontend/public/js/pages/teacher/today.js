import { html, mount, delegate } from '../../utils/dom.js';
import { timetableApi, qrApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { dataTable, statusPill, badge, act, formModal } from '../../components/kit.js';
import { openModal } from '../../components/modal.js';
import { formatDateLong } from '../../utils/format.js';

export default async function render({ view, ctx, refresh }) {
  const [classes, unmarked] = await Promise.all([timetableApi.today(), timetableApi.unmarked().catch(() => [])]);
  ctx.live.on('notification', refresh);
  mount(view, html`
    ${pageHeader('Today', formatDateLong())}
    ${unmarked.length ? html`<div class="notice notice-warning" role="status"><div><div class="notice-title">${unmarked.length} class${unmarked.length > 1 ? 'es have' : ' has'} no attendance</div>
      ${unmarked.slice(0, 5).map(u => html`<div class="small">${u.date} · ${u.subject ? u.subject.name : ''} <button class="btn-link" data-resolve="${u._id}">Explain</button></div>`)}</div></div>` : ''}
    ${classes.length ? dataTable([
      { label: 'Time', render: c => (c.startTime ? `${c.startTime}–${c.endTime}` : c.slot) },
      { label: 'Class', render: c => html`<span class="cell-strong">${c.subject ? c.subject.name : ''}</span><div class="small muted">${c.section ? `${c.section.name} · ${c.section.sem}` : ''}${c.room ? ` · Room ${c.room}` : ''}</div>` },
      { label: 'Status', render: c => html`${statusPill(c.status)}${c.status === 'submitted' ? html` <span class="small muted">${c.attendance.present}/${c.attendance.present + c.attendance.absent} present</span>` : ''}` },
      { label: '', cls: 'right', render: c => (c.status === 'cancelled' ? '' : html`<a class="btn btn-primary btn-sm" href="#session/new/${c.subject._id || c.subject.id}">Take attendance</a>
        <button class="btn btn-outline btn-sm" data-qr="${c.id}" data-title="${c.subject ? c.subject.name : ''}">QR / code</button>
        <button class="btn btn-ghost btn-sm" data-cancel="${c.id}">Cancel class</button>`) }
    ], classes) : html`<div class="card">${emptyState('You have no classes scheduled today.')}</div>`}`);

  delegate(view, 'click', '[data-cancel]', (e, b) => formModal({ title: 'Cancel this class', submit: 'Cancel class', fields: [{ name: 'reason', label: 'Reason (students are told)', required: true }], onSubmit: async v => { await timetableApi.cancelClass(b.dataset.cancel, v.reason); refresh(); } }));
  delegate(view, 'click', '[data-resolve]', (e, b) => formModal({
    title: 'Explain a class without attendance', submit: 'Save',
    fields: [{ name: 'action', type: 'select', label: 'What happened', options: [{ value: 'explained', label: 'Explained (kept as is)' }, { value: 'cancelled', label: 'Class was cancelled' }, { value: 'completed_without_attendance', label: 'Held, attendance not recorded' }] }, { name: 'reason', type: 'textarea', label: 'Reason', required: true }],
    onSubmit: async v => { await timetableApi.resolve(b.dataset.resolve, v); refresh(); }
  }));
  delegate(view, 'click', '[data-qr]', async (e, b) => {
    const id = b.dataset.qr;
    try { await qrApi.start(id); } catch (err) { return act(async () => { throw err; }); }
    let timer;
    const modal = openModal({
      title: `Attendance code — ${b.dataset.title}`, wide: true, confirmText: 'Close window for students', cancelText: 'Keep open',
      body: html`<div style="text-align:center"><img id="qrImg" alt="QR code for attendance" style="width:260px;height:260px"><div id="qrCode" style="font-size:44px;letter-spacing:8px;font-weight:700;margin:8px 0">······</div>
        <div class="small muted">The code changes every few seconds. Students scan it or type it. You still review and submit the final register.</div>
        <div id="qrCount" class="mt-12 strong"></div></div>`,
      async onConfirm() { clearInterval(timer); await qrApi.close(id); return true; },
      onOpen: el => {
        const tick = async () => {
          try {
            const [c, s] = await Promise.all([qrApi.current(id), qrApi.scans(id)]);
            el.querySelector('#qrImg').src = c.qr; el.querySelector('#qrCode').textContent = c.code;
            el.querySelector('#qrCount').textContent = `${s.accepted.length} student${s.accepted.length === 1 ? '' : 's'} marked${s.rejected ? ` · ${s.rejected} refused` : ''}`;
          } catch (err) { clearInterval(timer); el.querySelector('#qrCode').textContent = 'Closed'; }
        };
        tick(); timer = setInterval(tick, 4000);
        ctx.live.on('qr.scan', tick);
        new MutationObserver((_, o) => { if (!document.body.contains(el)) { clearInterval(timer); o.disconnect(); } }).observe(document.body, { childList: true });
      }
    });
    return modal;
  });
}
