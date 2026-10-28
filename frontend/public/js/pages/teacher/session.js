import { html, mount, $, delegate } from '../../utils/dom.js';
import { facultyApi } from '../../api/endpoints.js';
import { ApiError } from '../../api/client.js';
import { icons } from '../../components/icons.js';
import { toast } from '../../components/toast.js';
import { formatDate, todayISO } from '../../utils/format.js';

/**
 * Attendance marking for ONE class session = subject + date + time slot.
 * The same screen creates a new session or corrects an existing one; it asks the server
 * whether the chosen slot was already submitted and says so, so duplicates can not happen
 * by accident (and the server enforces it regardless).
 */
export default async function render({ view, params, ctx }) {
  const editing = Boolean(params.sessionId);
  const slots = ctx.timeSlots;

  const state = { subject: null, students: [], marks: {}, date: todayISO(), slot: slots[1], sessionId: null, existing: null };

  if (editing) {
    const d = await facultyApi.session(params.sessionId);
    Object.assign(state, { subject: d.subject, students: d.students, date: d.session.date, slot: d.session.slot, sessionId: d.session.id, existing: d.session.counts });
    d.students.forEach(s => { if (s.status) state.marks[s.id] = s.status; });
  } else {
    const [subjects, students] = await Promise.all([facultyApi.subjects(), facultyApi.students(params.subjectId)]);
    const subject = subjects.find(s => s.id === params.subjectId);
    if (!subject) throw new Error('This subject is not assigned to you.');
    Object.assign(state, { subject: { id: subject.id, name: subject.name, section: subject.section }, students });
  }

  mount(view, html`
    <a href="#classes" class="back-link">${icons.back} My classes</a>
    <div class="console">
      <div class="console-head">
        <div><h1>${state.subject.name}</h1><div class="sub">${state.subject.section.name} · ${state.subject.section.sem}</div></div>
        <div class="console-ctx">
          <div class="field"><label for="sessDate">Date</label><input type="date" id="sessDate" value="${state.date}" max="${todayISO()}"></div>
          <div class="field"><label for="sessSlot">Time slot</label><select id="sessSlot">${slots.map(t => html`<option value="${t}" ${t === state.slot ? 'selected' : ''}>${t}</option>`)}</select></div>
        </div>
      </div>
      <div class="session-status" id="sessStatus" role="status"></div>

      <div class="console-tools">
        <div class="search-box"><input type="search" id="stuSearch" placeholder="Find a student by name or roll number" aria-label="Find a student"></div>
        <div class="tally" aria-live="polite"><span class="t-p"><b id="cntP">0</b> present</span><span class="t-a"><b id="cntA">0</b> absent</span><span class="t-u"><b id="cntU">0</b> unmarked</span></div>
        <div class="flex gap-8"><button type="button" class="btn btn-outline btn-sm" id="allP">All present</button><button type="button" class="btn btn-outline btn-sm" id="allA">All absent</button></div>
      </div>

      <div class="roster" id="rows" role="list" aria-label="Students of ${state.subject.name}"></div>
      <p class="small muted">Tip: select a student and press <kbd>P</kbd> or <kbd>A</kbd>; the next student is selected automatically.</p>

      <div class="console-bar"><div class="small muted" id="barMsg"></div><button type="button" class="btn btn-primary btn-lg" id="submitBtn">Submit attendance</button></div>
    </div>
  `);

  const rows = $('#rows', view);
  const dateInput = $('#sessDate', view);
  const slotSelect = $('#sessSlot', view);
  const submit = $('#submitBtn', view);

  let filter = '';
  function paintRows() {
    const q = filter.trim().toLowerCase();
    const shown = state.students.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.rollNo).toLowerCase().includes(q));
    mount(rows, shown.length ? shown.map(s => {
      const m = state.marks[s.id];
      return html`<div class="rrow ${m === 'P' ? 'is-p' : m === 'A' ? 'is-a' : ''}" role="listitem" tabindex="0" data-row="${s.id}">
        <span class="roll">${s.rollNo}</span><span class="rname">${s.name}</span>
        <span class="seg" role="group" aria-label="Attendance for ${s.name}">
          <button type="button" class="seg-p ${m === 'P' ? 'on' : ''}" data-mark="P" data-id="${s.id}" aria-pressed="${m === 'P'}">Present</button>
          <button type="button" class="seg-a ${m === 'A' ? 'on' : ''}" data-mark="A" data-id="${s.id}" aria-pressed="${m === 'A'}">Absent</button></span></div>`;
    }) : html`<div class="empty-state">No student matches this search.</div>`);
    const p = state.students.filter(s => state.marks[s.id] === 'P').length;
    const a = state.students.filter(s => state.marks[s.id] === 'A').length;
    const u = state.students.length - p - a;
    $('#cntP', view).textContent = p; $('#cntA', view).textContent = a; $('#cntU', view).textContent = u;
    $('#barMsg', view).textContent = u ? `${u} student${u === 1 ? '' : 's'} still to mark` : 'Everyone is marked. Ready to submit.';
    submit.disabled = state.students.length === 0 || u > 0;
    submit.textContent = state.sessionId ? 'Update attendance' : 'Submit attendance';
  }

  function paintStatus(text, tone = 'muted') {
    const el = $('#sessStatus', view);
    el.className = `session-status ${tone === 'muted' ? 'muted' : `text-${tone}`}`;
    el.textContent = text;
  }

  /** Asks the server whether this subject/date/slot already has attendance. */
  async function checkSlot() {
    state.date = dateInput.value; state.slot = slotSelect.value;
    if (!state.date) return paintStatus('Choose a date.', 'red');
    if (editing && state.sessionId) return paintStatus(`Editing the session of ${formatDate(state.date)}. Changing the date or slot moves it.`);
    try {
      const found = await facultyApi.lookup({ subjectId: state.subject.id, date: state.date, slot: state.slot });
      if (found.exists) {
        const d = await facultyApi.session(found.sessionId);
        state.sessionId = found.sessionId;
        state.marks = {};
        d.students.forEach(s => { if (s.status) state.marks[s.id] = s.status; });
        paintStatus(`Attendance for this slot was already submitted (${d.session.counts.present} present, ${d.session.counts.absent} absent). It is loaded below — saving will correct it.`, 'amber');
      } else {
        if (state.sessionId) { state.marks = {}; }
        state.sessionId = null;
        paintStatus('Not submitted yet for this date and slot.');
      }
    } catch (err) { paintStatus(err.message, 'red'); }
    paintRows();
  }

  const setMark = (id, mark) => { if (state.marks[id] === mark) delete state.marks[id]; else state.marks[id] = mark; paintRows(); };
  delegate(rows, 'click', '[data-mark]', (e, btn) => setMark(btn.dataset.id, btn.dataset.mark));
  rows.addEventListener('keydown', e => {
    const row = e.target.closest('[data-row]');
    if (!row || e.target.tagName === 'BUTTON') return;
    const k = e.key.toLowerCase();
    if (k === 'p' || k === 'a') {
      e.preventDefault();
      const id = row.dataset.row;
      state.marks[id] = k.toUpperCase();
      paintRows();
      const again = rows.querySelector(`[data-row="${id}"]`);
      (again && again.nextElementSibling ? again.nextElementSibling : again)?.focus();
    } else if (k === 'arrowdown' || k === 'arrowup') {
      e.preventDefault();
      (k === 'arrowdown' ? row.nextElementSibling : row.previousElementSibling)?.focus();
    }
  });
  $('#stuSearch', view).addEventListener('input', e => { filter = e.target.value; paintRows(); });
  $('#allP', view).addEventListener('click', () => { state.students.forEach(s => { state.marks[s.id] = 'P'; }); paintRows(); });
  $('#allA', view).addEventListener('click', () => { state.students.forEach(s => { state.marks[s.id] = 'A'; }); paintRows(); });
  dateInput.addEventListener('change', checkSlot);
  slotSelect.addEventListener('change', checkSlot);

  submit.addEventListener('click', async () => {
    const records = state.students.map(s => ({ studentId: s.id, status: state.marks[s.id] }));
    if (records.some(r => !r.status)) return toast('Mark every student before submitting.', 'error');
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span>';
    try {
      let outcome;
      if (state.sessionId) {
        outcome = await facultyApi.updateSession(state.sessionId, { date: state.date, slot: state.slot, records });
        outcome.created = false;
      } else {
        outcome = await facultyApi.submit({ subjectId: state.subject.id, date: state.date, slot: state.slot, records, expectNew: true });
      }
      const present = records.filter(r => r.status === 'P').length;
      mount(view, html`<div class="confirm-screen">
        <div class="confirm-icon">${icons.check}</div>
        <h2>${outcome.created ? 'Attendance submitted' : 'Attendance updated'}</h2>
        <p>${present} present, ${records.length - present} absent · ${formatDate(state.date)}, ${state.slot}</p>
        <div class="flex gap-10" style="justify-content:center"><a href="#classes" class="btn btn-primary">Back to My Classes</a>
          <a href="#session/new/${state.subject.id}" class="btn btn-outline">Mark another session</a></div></div>`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SESSION_EXISTS') {
        toast('Someone has just submitted this slot. Loading it so you can review and correct it.', 'error');
        state.sessionId = null; await checkSlot();
      } else toast(err.message, 'error');
      submit.disabled = false;
      paintRows();
    }
  });

  paintRows();
  await checkSlot();
}
