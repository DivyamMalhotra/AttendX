import { html, mount, delegate } from '../../utils/dom.js';
import { qrApi } from '../../api/phase2.js';
import { pageHeader, emptyState, notice } from '../../components/ui.js';
import { toast } from '../../components/toast.js';
import { statusPill } from '../../components/kit.js';

const PAYLOAD = /^attendx:qr:([a-f0-9]{24}):(\d{6})$/;

/** Best-effort position for classrooms that use a geofence. The server decides whether it is good enough. */
const position = () => new Promise(resolve => {
  if (!navigator.geolocation) return resolve({});
  navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    () => resolve({}), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
});

export default async function render({ view, refresh }) {
  const open = await qrApi.openForStudent();
  const camera = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  let stream = null;
  const stop = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };

  async function submit(sessionId, code) {
    const needsPlace = (open.find(o => o.id === sessionId) || {}).geofence !== false;
    const where = needsPlace ? await position() : {};
    try {
      const r = await qrApi.scan({ sessionId, code, ...where });
      toast(r.alreadyMarked ? 'You are already marked for this class.' : 'Attendance marked. Your teacher confirms the final register.', 'success');
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  }

  mount(view, html`
    ${pageHeader('Mark my attendance', 'Use the code or QR shown by your teacher in the classroom.')}
    ${notice('info', 'How this works', 'Your teacher opens a short window and shows a code that changes every few seconds. Your teacher still reviews and submits the final register, and can correct any entry.')}
    ${open.length ? open.map(o => html`<div class="card card-pad" style="margin-bottom:12px" data-window="${o.id}">
      <div class="flex-between wrap"><div><div class="strong">${o.subject}</div><div class="small muted">${o.startTime ? `${o.startTime}–${o.endTime}` : o.slot}${o.geofence ? ' · your location will be checked' : ''}</div></div>
        ${o.marked ? statusPill('completed', 'Marked') : statusPill('open', 'Open')}</div>
      ${o.marked ? '' : html`<form class="flex gap-8 wrap mt-12" data-code-form="${o.id}">
        <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" aria-label="6-digit code" style="max-width:180px" required>
        <button type="submit" class="btn btn-primary">Submit code</button>
        ${camera ? html`<button type="button" class="btn btn-outline" data-scan>Scan QR with camera</button>` : ''}</form>`}
    </div>`) : html`<div class="card">${emptyState('No class is taking attendance by code right now.')}</div>`}
    <div id="cameraBox" class="card card-pad hidden" style="margin-top:12px"><video id="cam" playsinline muted style="width:100%;max-width:420px;border-radius:8px"></video>
      <div class="mt-8"><button type="button" class="btn btn-ghost btn-sm" id="camStop">Close camera</button></div></div>`);

  delegate(view, 'submit', '[data-code-form]', (e, form) => {
    e.preventDefault();
    submit(form.dataset.codeForm, form.elements.code.value.replace(/\D/g, ''));
  });

  const box = view.querySelector('#cameraBox');
  view.querySelector('#camStop').addEventListener('click', () => { stop(); box.classList.add('hidden'); });
  delegate(view, 'click', '[data-scan]', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) { return toast('The camera could not be opened. Type the code instead.', 'error'); }
    const video = view.querySelector('#cam');
    video.srcObject = stream; box.classList.remove('hidden'); await video.play();
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!stream) return;
      try {
        const found = (await detector.detect(video)).map(c => PAYLOAD.exec(c.rawValue)).find(Boolean);
        if (found) { stop(); box.classList.add('hidden'); return submit(found[1], found[2]); }
      } catch (err) { /* keep scanning */ }
      setTimeout(tick, 300);
    };
    tick();
  });
  window.addEventListener('hashchange', stop, { once: true });
}
