import { html, mount, delegate } from '../../utils/dom.js';
import { timetableApi } from '../../api/phase2.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, statusPill, formModal, act, confirmThen, can } from '../../components/kit.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function render({ view, ctx, refresh, params }) {
  if (params.id) return detail(view, ctx, params.id);
  const [rows, sections, sessions] = await Promise.all([timetableApi.list(), adminApi.sections(), adminApi.academicSessions()]);
  const manage = can(ctx, 'timetable.manage');
  mount(view, html`${pageHeader('Timetables', 'Each change is a new version; approved versions generate the daily classes.', manage ? html`<button class="btn btn-primary" id="new">New timetable</button>` : '')}
    ${dataTable([
      { label: 'Class', render: t => (t.section ? `${t.section.name} · ${t.section.sem}` : '') }, { label: 'Session', render: t => (t.academicSession ? t.academicSession.name : '') },
      { label: 'Version', render: t => `v${t.version}` }, { label: 'Effective', render: t => `${t.effectiveFrom}${t.effectiveTo ? ` → ${t.effectiveTo}` : ''}` }, { label: 'Status', render: t => statusPill(t.status === 'archived' ? 'closed' : t.status, t.status === 'archived' ? 'Archived' : t.status) },
      { label: '', cls: 'right', render: t => html`<a class="btn btn-outline btn-sm" href="#timetable/${t._id}">${t.status === 'draft' && manage ? 'Edit' : 'View'}</a>` }
    ], rows, { empty: 'No timetables yet.' })}`);
  view.querySelector('#new')?.addEventListener('click', () => formModal({
    title: 'New timetable (draft)', intro: 'If the class already has a timetable, its entries are copied into the new draft.',
    fields: [{ name: 'sectionId', type: 'select', label: 'Class', options: sections.map(s => ({ value: s._id, label: `${s.name} · ${s.sem}` })) }, { name: 'academicSessionId', type: 'select', label: 'Academic session', options: sessions.map(s => ({ value: s._id, label: s.name })) }, { name: 'effectiveFrom', type: 'date', label: 'Effective from', required: true }],
    async onSubmit(v) { const t = await timetableApi.create({ ...v, copyFromLatest: true }); location.hash = `#timetable/${t._id}`; }
  }));
}

async function detail(view, ctx, id) {
  const redraw = () => detail(view, ctx, id);
  const { timetable: t, entries } = await timetableApi.detail(id);
  const draft = t.status === 'draft' && can(ctx, 'timetable.manage');
  const [sections] = await Promise.all([adminApi.sections()]);
  const section = sections.find(s => s._id === String(t.section));
  const teachers = await adminApi.teachers();
  mount(view, html`<a class="back-link" href="#timetable">&larr; Timetables</a>
    ${pageHeader(`${section ? section.name : 'Timetable'} — version ${t.version}`, `${t.status} · effective from ${t.effectiveFrom}`, draft ? html`<button class="btn btn-outline" id="add">Add class</button> <button class="btn btn-primary" id="approve">Approve</button>` : '')}
    ${t.status === 'draft' ? html`<div class="notice notice-warning" role="status"><div><div class="notice-title">This is a draft</div>Teachers and students will not see these classes, and no daily classes are created, until you press <b>Approve</b>.</div></div>` : ''}
    ${dataTable([
      { label: 'Day', render: e => DAYS[e.dayOfWeek - 1] }, { label: 'Time', render: e => `${e.startTime}–${e.endTime}` }, { label: 'Subject', render: e => (e.subject ? e.subject.name : '') },
      { label: 'Teacher', render: e => (e.teacher ? e.teacher.name : '') }, { label: 'Room', render: e => e.room || '' },
      { label: '', cls: 'right', render: e => (draft ? html`<button class="btn btn-ghost btn-sm" data-rm="${e._id}">Remove</button>` : '') }
    ], entries, { empty: 'No classes yet.' })}`);
  view.querySelector('#add')?.addEventListener('click', () => formModal({
    title: 'Add a class', intro: 'A clash with another class of the same teacher, room or section is refused unless you give an override reason.',
    fields: [{ name: 'subjectId', type: 'select', label: 'Subject', options: (section ? section.subjects : []).map(s => ({ value: s._id, label: s.name })) },
      { name: 'teacherId', type: 'select', label: 'Teacher', options: [{ value: '', label: 'Subject\'s teacher' }, ...teachers.map(x => ({ value: x.id, label: x.name }))] },
      { name: 'dayOfWeek', type: 'select', label: 'Day', half: true, options: DAYS.map((d, i) => ({ value: i + 1, label: d })) }, { name: 'room', label: 'Room', half: true },
      { name: 'startTime', type: 'time', label: 'Start', half: true, required: true }, { name: 'endTime', type: 'time', label: 'End', half: true, required: true }, { name: 'overrideReason', label: 'Override reason (only to accept a clash)' }],
    async onSubmit(v) { await timetableApi.addEntry(id, { subjectId: v.subjectId, ...(v.teacherId ? { teacherId: v.teacherId } : {}), dayOfWeek: Number(v.dayOfWeek), startTime: v.startTime, endTime: v.endTime, room: v.room || undefined, ...(v.overrideReason ? { overrideReason: v.overrideReason } : {}) }); redraw(); }
  }));
  view.querySelector('#approve')?.addEventListener('click', () => confirmThen({ title: 'Approve timetable', message: 'It replaces the current version from its start date and classes are generated.', confirmText: 'Approve', run: () => timetableApi.approve(id), success: 'Approved.', after: redraw }));
  delegate(view, 'click', '[data-rm]', (e, b) => act(() => timetableApi.removeEntry(id, b.dataset.rm), { after: redraw }));
}
