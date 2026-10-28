import { html, mount, delegate } from '../../utils/dom.js';
import { examsApi } from '../../api/phase2.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, statusPill, formModal, act, confirmThen, can } from '../../components/kit.js';
import { openModal } from '../../components/modal.js';
import { formatDate } from '../../utils/format.js';

export default async function render({ view, ctx, refresh }) {
  const exams = await examsApi.list({});
  const cfg = can(ctx, 'exams.configure');
  mount(view, html`${pageHeader('Examinations', 'Schedule exams, review submitted marks, then lock and publish results.',
    cfg ? html`<button class="btn btn-outline" id="pol">Grading policy</button> <button class="btn btn-primary" id="new">Schedule exam</button>` : '')}
    ${dataTable([
      { label: 'Exam', render: e => html`<span class="cell-strong">${e.name}</span><div class="small muted">${e.subject ? e.subject.name : ''} · ${e.section ? `${e.section.name} ${e.section.sem}` : ''}</div>` },
      { label: 'Date', render: e => formatDate(e.date) }, { label: 'Status', render: e => statusPill(e.status) },
      { label: '', cls: 'right', render: e => html`<button class="btn btn-outline btn-sm" data-marks="${e._id}">Marks</button>
        ${e.status === 'submitted' && can(ctx, 'marks.review') ? html` <button class="btn btn-primary btn-sm" data-act="review" data-id="${e._id}">Review</button>` : ''}
        ${e.status === 'reviewed' && can(ctx, 'results.publish') ? html` <button class="btn btn-primary btn-sm" data-act="lock" data-id="${e._id}">Lock</button>` : ''}
        ${e.status === 'locked' && can(ctx, 'results.publish') ? html` <button class="btn btn-primary btn-sm" data-act="publish" data-id="${e._id}">Publish</button>` : ''}
        ${['locked', 'published'].includes(e.status) && can(ctx, 'results.reopen') ? html` <button class="btn btn-ghost btn-sm" data-act="reopen" data-id="${e._id}">Reopen</button>` : ''}` }
    ], exams, { empty: 'No examinations scheduled.' })}`);

  delegate(view, 'click', '[data-marks]', async (e, b) => {
    const s = await examsApi.sheet(b.dataset.marks);
    openModal({ title: `${s.exam.name} — ${s.exam.subject}`, wide: true, footer: false, body: dataTable([{ label: 'Roll no', render: x => x.rollNo }, { label: 'Name', render: x => x.name }, { label: 'Marks', cls: 'right', render: x => (x.absent ? 'Absent' : x.marks ?? '—') }], s.students) });
  });
  delegate(view, 'click', '[data-act]', (e, b) => {
    const id = b.dataset.id; const a = b.dataset.act;
    if (a === 'review') return formModal({ title: 'Review marks', submit: 'Save decision', fields: [{ name: 'decision', type: 'select', label: 'Decision', options: [{ value: 'approve', label: 'Approve' }, { value: 'return', label: 'Return to teacher' }] }, { name: 'reason', type: 'textarea', label: 'Note (needed when returning)' }], onSubmit: async v => { await examsApi.review(id, { decision: v.decision, reason: v.reason || undefined }); refresh(); } });
    if (a === 'reopen') return formModal({ title: 'Reopen results', submit: 'Reopen', intro: 'Published results will be hidden from students until corrected and published again.', fields: [{ name: 'reason', label: 'Reason', required: true }], onSubmit: async v => { await examsApi.reopen(id, v.reason); refresh(); } });
    const text = { lock: ['Lock marks', 'No further changes are possible without reopening.'], publish: ['Publish results', 'Students see their grades and are notified. A snapshot is frozen.'] }[a];
    confirmThen({ title: text[0], message: text[1], confirmText: text[0], run: () => examsApi[a](id), success: 'Done.', after: refresh });
  });

  view.querySelector('#new')?.addEventListener('click', async () => {
    const [sections, sessions] = await Promise.all([adminApi.sections(), adminApi.academicSessions()]);
    const subjects = sections.flatMap(s => (s.subjects || []).map(x => ({ value: x._id || x.id, label: `${x.name} — ${s.name} ${s.sem}` })));
    formModal({
      title: 'Schedule an exam', wide: true, submit: 'Schedule',
      fields: [{ name: 'name', label: 'Name', required: true }, { name: 'type', type: 'select', label: 'Type', half: true, options: ['internal', 'midterm', 'final', 'practical', 'other'].map(v => ({ value: v, label: v })) },
        { name: 'subjectId', type: 'select', label: 'Subject', half: true, required: true, options: subjects }, { name: 'academicSessionId', type: 'select', label: 'Academic session', options: sessions.map(s => ({ value: s._id, label: s.name })) },
        { name: 'date', type: 'date', label: 'Date', required: true, half: true }, { name: 'venue', label: 'Venue', half: true },
        { name: 'startTime', type: 'time', label: 'Start', half: true }, { name: 'endTime', type: 'time', label: 'End', half: true },
        { name: 'maxMarks', type: 'number', label: 'Maximum marks', required: true, half: true, value: 100 }, { name: 'passMarks', type: 'number', label: 'Pass marks', required: true, half: true, value: 40 }],
      async onSubmit(v) {
        await examsApi.create({ name: v.name, type: v.type, subjectId: v.subjectId, academicSessionId: v.academicSessionId, date: v.date, venue: v.venue || undefined, startTime: v.startTime || undefined, endTime: v.endTime || undefined, maxMarks: Number(v.maxMarks), passMarks: Number(v.passMarks) });
        refresh();
      }
    });
  });
  view.querySelector('#pol')?.addEventListener('click', async () => {
    const p = await examsApi.policy().catch(() => null);
    const bands = (p && p.bands ? p.bands : [{ minPercent: 90, grade: 'O', points: 10 }, { minPercent: 75, grade: 'A', points: 8 }, { minPercent: 50, grade: 'C', points: 6 }, { minPercent: 0, grade: 'F', points: 0, pass: false }]);
    formModal({
      title: 'Grading policy', intro: 'One band per line: minimum percent, grade, points, and "fail" for a failing band. Results are published with a frozen copy of this scale.',
      fields: [{ name: 'name', label: 'Policy name', value: p ? p.name : 'Grading scale', required: true }, { name: 'bands', type: 'textarea', rows: 8, label: 'Bands', value: bands.map(b => `${b.minPercent}, ${b.grade}, ${b.points}${b.pass === false ? ', fail' : ''}`).join('\n') }],
      async onSubmit(v) {
        const parsed = v.bands.split('\n').map(l => l.split(',').map(x => x.trim())).filter(x => x[0]).map(([m, g, pts, f]) => ({ minPercent: Number(m), grade: g, points: Number(pts), pass: f !== 'fail' }));
        await examsApi.savePolicy({ name: v.name, bands: parsed });
      }
    });
  });
}
