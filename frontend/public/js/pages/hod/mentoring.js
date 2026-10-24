import { html, mount, delegate } from '../../utils/dom.js';
import { mentorApi } from '../../api/phase2.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader } from '../../components/ui.js';
import { cap } from '../../utils/format.js';
import { dataTable, statusPill, formModal, confirmThen, tabs, can } from '../../components/kit.js';

export default async function render({ view, ctx }) {
  mount(view, pageHeader('Mentors & parents', 'Each student has one active mentor. Parents get read-only access to one verified child.'));
  const host = document.createElement('div');
  view.appendChild(host);
  const items = [];
  if (can(ctx, 'mentors.manage')) items.push({ key: 'mentors', label: 'Mentors' });
  if (can(ctx, 'parents.manage')) items.push({ key: 'parents', label: 'Parents' });
  await tabs(host, items, { render: (k, body) => (k === 'mentors' ? mentors(body) : parents(body)) });
}

async function mentors(body) {
  const redraw = () => mentors(body);
  const rows = await mentorApi.assignments();
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="assign">Assign a mentor to a class</button></div>
    ${dataTable([
      { label: 'Student', render: a => html`<span class="cell-strong">${a.student && a.student.user ? a.student.user.name : ''}</span><div class="small muted">${a.student ? a.student.rollNo : ''} · ${a.student && a.student.section ? a.student.section.name : ''}</div>` },
      { label: 'Mentor', render: a => (a.mentor ? a.mentor.name : '') }, { label: 'Since', render: a => String(a.from).slice(0, 10) }
    ], rows, { empty: 'No mentors assigned yet.' })}`);
  body.querySelector('#assign').addEventListener('click', async () => {
    const [sections, teachers] = await Promise.all([adminApi.sections(), adminApi.teachers()]);
    formModal({
      title: 'Assign a mentor', intro: 'Every active student of the chosen section gets this mentor; any previous mentor is ended and kept in the history.',
      fields: [{ name: 'sectionId', type: 'select', label: 'Section', options: sections.map(s => ({ value: s._id, label: `${s.name} · ${s.sem}` })) }, { name: 'mentorId', type: 'select', label: 'Mentor', options: teachers.filter(t => t.active).map(t => ({ value: t.id, label: t.name })) }],
      async onSubmit(v) {
        const { rows: students } = await adminApi.students({ sectionId: v.sectionId, limit: 200 });
        if (!students.length) throw new Error('That section has no students.');
        await mentorApi.assign({ studentIds: students.map(s => s.id), mentorId: v.mentorId });
        redraw();
      }
    });
  });
}

async function parents(body) {
  const redraw = () => parents(body);
  const rows = await mentorApi.parents({});
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="add">Create parent account</button></div>
    ${dataTable([
      { label: 'Parent', render: l => html`<span class="cell-strong">${l.parent ? l.parent.name : ''}</span><div class="small muted">${l.parent ? l.parent.email : ''}</div>` },
      { label: 'Student', render: l => (l.student ? `${l.student.rollNo} · ${l.student.user ? l.student.user.name : ''}` : '') }, { label: 'Relationship', render: l => cap(l.relationship) },
      { label: 'Status', render: l => statusPill(l.status === 'active' ? 'active' : 'cancelled', l.status) },
      { label: '', cls: 'right', render: l => (l.status === 'active' ? html`<button class="btn btn-ghost btn-sm" data-revoke="${l._id}">Revoke access</button>` : '') }
    ], rows, { empty: 'No parent accounts.' })}`);
  body.querySelector('#add').addEventListener('click', async () => {
    const { rows: students } = await adminApi.students({ limit: 200 });
    formModal({
      title: 'Create parent account', intro: 'Record how the person was verified (for example, ID checked at the office). Access is limited to this one student and is read-only.',
      fields: [{ name: 'name', label: 'Parent name', required: true }, { name: 'email', type: 'email', label: 'Email (sign-in)', required: true }, { name: 'password', type: 'password', label: 'Temporary password', required: true, autocomplete: 'new-password' },
        { name: 'studentId', type: 'select', label: 'Student', options: students.map(s => ({ value: s.id, label: `${s.rollNo} · ${s.name}` })) }, { name: 'relationship', type: 'select', label: 'Relationship', options: ['mother', 'father', 'guardian', 'other'].map(v => ({ value: v, label: v })) },
        { name: 'verificationNote', label: 'How was the person verified?', required: true }],
      async onSubmit(v) { await mentorApi.createParent(v); redraw(); }
    });
  });
  delegate(body, 'click', '[data-revoke]', (e, b) => confirmThen({ title: 'Revoke access', message: 'The parent can no longer see this student.', confirmText: 'Revoke', danger: true, run: () => mentorApi.revokeLink(b.dataset.revoke), success: 'Access revoked.', after: redraw }));
}
