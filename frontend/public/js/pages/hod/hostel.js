import { html, mount, delegate } from '../../utils/dom.js';
import { hostelApi } from '../../api/phase2.js';
import { pageHeader } from '../../components/ui.js';
import { dataTable, statusPill, formModal, act, confirmThen, tabs } from '../../components/kit.js';
import { formatDate, formatMoney, parseRupees, cap } from '../../utils/format.js';

export default async function render({ view }) {
  mount(view, pageHeader('Hostel', 'Hostels, rooms and who lives where. Capacity can never be exceeded.'));
  const host = document.createElement('div');
  view.appendChild(host);
  await tabs(host, [{ key: 'alloc', label: 'Allocations' }, { key: 'hostels', label: 'Hostels & rooms' }], { render: (k, b) => (k === 'alloc' ? allocations(b) : hostels(b)) });
}

async function allocations(body) {
  const redraw = () => allocations(body);
  const { rows } = await hostelApi.allocations({ status: 'active', limit: 200 });
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="alloc">Allocate a room</button></div>
    ${dataTable([
      { label: 'Student', render: a => (a.student ? html`<span class="cell-strong">${a.student.user ? a.student.user.name : ''}</span><div class="small muted">${a.student.rollNo}</div>` : '') },
      { label: 'Room', render: a => `${a.hostel ? a.hostel.name : ''} · ${a.room ? a.room.number : ''}` }, { label: 'Since', render: a => formatDate(a.from) }, { label: 'Status', render: a => statusPill(a.status) },
      { label: '', cls: 'right', render: a => html`${a.status === 'allocated' ? html`<button class="btn btn-outline btn-sm" data-in="${a._id}">Check in</button> ` : ''}<button class="btn btn-ghost btn-sm" data-end="${a._id}">End stay</button>` }
    ], rows, { empty: 'Nobody is allocated.' })}`);
  body.querySelector('#alloc').addEventListener('click', async () => {
    const hs = await hostelApi.hostels();
    const rooms = (await Promise.all(hs.map(async h => (await hostelApi.rooms(h._id)).map(r => ({ ...r, h }))))).flat().filter(r => r.active && r.occupied < r.capacity);
    formModal({
      title: 'Allocate a room', fields: [{ name: 'rollNo', label: 'Student roll number', required: true }, { name: 'roomId', type: 'select', label: 'Room', options: rooms.map(r => ({ value: r._id, label: `${r.h.name} · ${r.number} (${r.capacity - r.occupied} free)` })) },
        { name: 'charge', type: 'checkbox', label: 'Add the hostel fee to the student\'s fees', value: true }],
      async onSubmit(v) { await hostelApi.allocate({ student: { rollNo: v.rollNo }, roomId: v.roomId, charge: v.charge }); redraw(); }
    });
  });
  delegate(body, 'click', '[data-in]', (e, b) => act(() => hostelApi.checkIn(b.dataset.in), { success: 'Checked in.', after: redraw }));
  delegate(body, 'click', '[data-end]', (e, b) => confirmThen({ title: 'End stay', message: 'The bed is released.', confirmText: 'End stay', danger: true, run: () => hostelApi.end(b.dataset.end, 'Checked out'), success: 'Stay ended.', after: redraw }));
}

async function hostels(body) {
  const redraw = () => hostels(body);
  const hs = await hostelApi.hostels();
  mount(body, html`<div class="toolbar"><button class="btn btn-primary" id="add">Add hostel</button></div>
    ${dataTable([
      { label: 'Hostel', render: h => html`<span class="cell-strong">${h.name}</span> <span class="faint">${h.code}</span>` }, { label: 'Type', render: h => cap(h.type) },
      { label: 'Occupancy', cls: 'right', render: h => `${h.occupied}/${h.capacity} (${h.rooms} rooms)` }, { label: 'Fee per term', cls: 'right', render: h => formatMoney(h.feePerTermPaise) },
      { label: '', cls: 'right', render: h => html`<button class="btn btn-outline btn-sm" data-rooms="${h._id}">Add rooms</button>` }
    ], hs, { empty: 'No hostels yet.' })}`);
  body.querySelector('#add').addEventListener('click', () => formModal({
    title: 'Add hostel', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'code', label: 'Code', required: true, half: true }, { name: 'type', type: 'select', label: 'Type', half: true, options: ['boys', 'girls', 'mixed'].map(v => ({ value: v, label: v })) }, { name: 'fee', label: 'Fee per term (INR)', value: '0' }],
    async onSubmit(v) { await hostelApi.saveHostel({ name: v.name, code: v.code, type: v.type, feePerTermPaise: parseRupees(v.fee) ?? 0 }); redraw(); }
  }));
  delegate(body, 'click', '[data-rooms]', (e, b) => formModal({
    title: 'Add rooms', fields: [{ name: 'floor', type: 'number', label: 'Floor', value: 1, half: true }, { name: 'capacity', type: 'number', label: 'Beds per room', value: 2, min: 1, half: true }, { name: 'numbers', label: 'Room numbers (comma separated)', required: true, placeholder: '101, 102, 103' }],
    async onSubmit(v) { await hostelApi.addRooms(b.dataset.rooms, [{ floor: Number(v.floor), capacity: Number(v.capacity), numbers: v.numbers.split(',').map(x => x.trim()).filter(Boolean) }]); redraw(); }
  }));
}
