import { html, mount, delegate } from '../../utils/dom.js';
import { mentorApi } from '../../api/phase2.js';
import { adminApi } from '../../api/endpoints.js';
import { pageHeader } from '../../components/ui.js';
import { cap } from '../../utils/format.js';
import { dataTable, statusPill, formModal, confirmThen, tabs } from '../../components/kit.js';

export default async function render({ view }) {
  mount(view, pageHeader('Mentors & parents', 'Each student has one active mentor. Parents get access to one verified child: published results and fees only.'));
  const host = document.createElement('div');
  view.appendChild(host);
  await tabs(host, [{ key: 'mentors', label: 'Mentors' }, { key: 'parents', label: 'Parents' }], { render: (k, body) => (k === 'mentors' ? mentors(body) : parents(body)) });
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
      { label: 'Student', render: l => html`${l.student && l.student.user ? l.student.user.name : ''}<div class="small muted">${l.student ? l.student.rollNo : ''} \u00b7 ${cap(l.relationship)}</div>` },
      { label: 'Verified', render: l => String(l.verifiedAt).slice(0, 10) },
      { label: '', cls: 'right', render: l => html`<button class="btn btn-outline btn-sm" data-revoke="${l._id}">Revoke</button>` }
    ], rows, { empty: 'No parent accounts.' })}`);
  body.querySelector('#add').addEventListener('click', () => formModal({
    title: 'Create parent account', intro: 'Record how the person was verified (for example, ID checked at the office). Access is limited to this one student.',
    fields: [{ name: 'name', label: 'Parent name', required: true }, { name: 'email', type: 'email', label: 'Email (sign-in)', required: true }, { name: 'password', type: 'password', label: 'Temporary password', required: true },
      { name: 'rollNo', label: 'Student roll number', required: true }, { name: 'relationship', type: 'select', label: 'Relationship', options: ['mother', 'father', 'guardian', 'other'].map(v => ({ value: v, label: cap(v) })) },
      { name: 'verificationNote', label: 'How was the relationship verified?', required: true }],
    async onSubmit(v) {
      const { rows: found } = await adminApi.students({ q: v.rollNo, limit: 5 });
      const hit = found.find(s => s.rollNo === String(v.rollNo).replace(/\s+/g, '').toUpperCase());
      if (!hit) throw new Error('No student with that roll number.');
      await mentorApi.createParent({ name: v.name, email: v.email, password: v.password, studentId: hit.id, relationship: v.relationship, verificationNote: v.verificationNote });
      redraw();
    }
  }));
  delegate(body, 'click', '[data-revoke]', (e, b) => confirmThen({ title: 'Revoke access', message: 'The parent can no longer see this student.', confirmText: 'Revoke', run: async () => { await mentorApi.revokeLink(b.dataset.revoke); redraw(); } }));
}
