import { html, mount, delegate, debounce } from '../../utils/dom.js';
import { libraryApi } from '../../api/phase2.js';
import { pageHeader, pager } from '../../components/ui.js';
import { dataTable, statusPill, badge, formModal, act, tabs } from '../../components/kit.js';
import { formatDate, formatMoney } from '../../utils/format.js';

export default async function render({ view }) {
  mount(view, pageHeader('Library', 'Catalogue, loans and returns. Late fines become a separate charge on the student\'s fees.'));
  const host = document.createElement('div');
  view.appendChild(host);
  await tabs(host, [{ key: 'books', label: 'Books' }, { key: 'loans', label: 'Loans' }], { render: (k, body) => (k === 'books' ? books(body) : loans(body)) });
}

async function books(body, q = '') {
  const { rows, meta } = await libraryApi.books({ q: q || undefined, limit: 25 });
  mount(body, html`
    <div class="toolbar"><input type="search" id="q" placeholder="Search title, author or ISBN" value="${q}" style="min-width:240px">
      <button class="btn btn-primary" id="add">Add book</button><button class="btn btn-outline" id="issue">Issue a book</button><button class="btn btn-outline" id="ret">Return a book</button></div>
    ${dataTable([
      { label: 'Title', render: b => html`<span class="cell-strong">${b.title}</span><div class="small muted">${b.author || ''} ${b.isbn ? `· ${b.isbn}` : ''}</div>` },
      { label: 'Category', render: b => b.category }, { label: 'Available', cls: 'right', render: b => `${b.availableCopies}/${b.totalCopies}` },
      { label: '', cls: 'right', render: b => html`<button class="btn btn-outline btn-sm" data-copies="${b._id}">Add copies</button>` }
    ], rows, { empty: 'No books found.' })}${pager(meta)}`);
  const redraw = () => books(body, body.querySelector('#q').value);
  body.querySelector('#q').addEventListener('input', debounce(e => books(body, e.target.value.trim()), 350));
  body.querySelector('#add').addEventListener('click', () => formModal({
    title: 'Add a book', fields: [{ name: 'title', label: 'Title', required: true }, { name: 'author', label: 'Author' }, { name: 'isbn', label: 'ISBN', half: true }, { name: 'category', label: 'Category', half: true }, { name: 'copies', type: 'number', label: 'Copies', value: 1, min: 0, max: 200 }],
    async onSubmit(v) { await libraryApi.addBook({ title: v.title, author: v.author || undefined, isbn: v.isbn || undefined, category: v.category || undefined, copies: Number(v.copies) }); redraw(); }
  }));
  body.querySelector('#issue').addEventListener('click', () => formModal({
    title: 'Issue a book', fields: [{ name: 'rollNo', label: 'Student roll number', required: true }, { name: 'bookId', type: 'select', label: 'Book', required: true, options: rows.map(b => ({ value: b._id, label: `${b.title} (${b.availableCopies} available)` })) }],
    async onSubmit(v) { await libraryApi.issue({ student: { rollNo: v.rollNo }, bookId: v.bookId }); redraw(); }
  }));
  body.querySelector('#ret').addEventListener('click', () => formModal({
    title: 'Return a book', fields: [{ name: 'accessionNo', label: 'Copy number (e.g. LIB-000001)', required: true }],
    async onSubmit(v) {
      const r = await libraryApi.returnBook({ accessionNo: v.accessionNo });
      alert(r.fine ? `Returned late. A fine of ${formatMoney(r.fine)} was added to the student's fees.` : 'Returned.');
      redraw();
    }
  }));
  delegate(body, 'click', '[data-copies]', (e, b) => formModal({ title: 'Add copies', fields: [{ name: 'count', type: 'number', label: 'How many', value: 1, min: 1, max: 200, required: true }], async onSubmit(v) { await libraryApi.addCopies(b.dataset.copies, Number(v.count)); redraw(); } }));
}

async function loans(body, overdue = false) {
  const { rows } = await libraryApi.loans({ overdue: overdue ? 'true' : undefined, limit: 100 });
  mount(body, html`<div class="toolbar"><label class="check" style="margin:0"><input type="checkbox" id="od" ${overdue ? 'checked' : ''}> Overdue only</label></div>
    ${dataTable([
      { label: 'Book', render: l => html`<span class="cell-strong">${l.book ? l.book.title : ''}</span><div class="small muted">${l.copy ? l.copy.accessionNo : ''}</div>` },
      { label: 'Student', render: l => (l.student ? `${l.student.rollNo} · ${l.student.user ? l.student.user.name : ''}` : '') },
      { label: 'Due', render: l => html`${formatDate(l.dueDate)}${l.overdue ? html` ${badge('red', `${l.daysOverdue}d late`)}` : ''}` },
      { label: 'Status', render: l => statusPill(l.status) }, { label: 'Fine', cls: 'right', render: l => (l.fineNowPaise ? formatMoney(l.fineNowPaise) : '—') },
      { label: '', cls: 'right', render: l => (l.status === 'issued' ? html`<button class="btn btn-outline btn-sm" data-lost="${l.id}">Mark lost</button>` : '') }
    ], rows, { empty: 'No loans.' })}`);
  body.querySelector('#od').addEventListener('change', e => loans(body, e.target.checked));
  delegate(body, 'click', '[data-lost]', (e, b) => act(() => libraryApi.lost(b.dataset.lost), { success: 'Marked as lost.', after: () => loans(body, overdue) }));
}
