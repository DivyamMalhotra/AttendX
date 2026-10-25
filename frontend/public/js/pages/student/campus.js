import { html, mount } from '../../utils/dom.js';
import { libraryApi, hostelApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { badge, statusPill, dataTable } from '../../components/kit.js';
import { formatDate, formatMoney } from '../../utils/format.js';

export default async function render({ view }) {
  const [loans, stays] = await Promise.all([libraryApi.mine(), hostelApi.mine()]);
  const current = stays.find(s => ['allocated', 'checked_in'].includes(s.status));
  const out = loans.filter(l => l.status === 'issued');

  mount(view, html`
    ${pageHeader('Library & hostel', 'Your borrowed books, due dates and room allocation.')}
    <div class="card" style="margin-bottom:16px"><div class="card-title">Library — ${out.length} book${out.length === 1 ? '' : 's'} on loan</div>
      ${loans.length ? dataTable([
        { label: 'Book', render: l => html`<span class="cell-strong">${l.book ? l.book.title : ''}</span><div class="small muted">${l.book ? l.book.author : ''} ${l.copy ? `· ${l.copy.accessionNo}` : ''}</div>` },
        { label: 'Issued', render: l => formatDate(l.issuedOn) },
        { label: 'Due', render: l => html`${formatDate(l.dueDate)}${l.overdue ? html` <span class="text-red small">${l.daysOverdue} day${l.daysOverdue === 1 ? '' : 's'} late</span>` : ''}` },
        { label: 'Status', render: l => (l.overdue ? badge('red', 'Overdue') : statusPill(l.status)) },
        { label: 'Fine', cls: 'right', render: l => (l.fineNowPaise ? formatMoney(l.fineNowPaise) : '—') }
      ], loans) : emptyState('You have not borrowed any books.')}
      <div class="card-pad small muted">A fine for a late return is added to your fees as a separate charge and paid under Fees &amp; Payments.</div>
    </div>
    <div class="card"><div class="card-title">Hostel</div>
      ${current ? html`<div class="card-pad"><dl class="kv">
        <dt>Hostel</dt><dd>${current.hostel ? `${current.hostel.name} (${current.hostel.code})` : ''}</dd>
        <dt>Room</dt><dd>${current.room ? `${current.room.number}, floor ${current.room.floor}` : ''}</dd>
        <dt>Status</dt><dd>${statusPill(current.status)}</dd><dt>Since</dt><dd>${formatDate(current.from)}</dd></dl></div>` : emptyState('You do not have a hostel allocation.')}
      ${stays.filter(s => s !== current).length ? html`<div class="card-pad small muted">Earlier: ${stays.filter(s => s !== current).map(s => `${s.hostel ? s.hostel.name : ''} ${s.room ? s.room.number : ''} (${formatDate(s.from)}${s.to ? ` – ${formatDate(s.to)}` : ''})`).join('; ')}</div>` : ''}
    </div>`);
}
