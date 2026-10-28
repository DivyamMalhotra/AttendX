import { html, mount } from '../../utils/dom.js';
import { libraryApi } from '../../api/phase2.js';
import { pageHeader, emptyState } from '../../components/ui.js';
import { badge, statusPill, dataTable } from '../../components/kit.js';
import { formatDate, formatMoney } from '../../utils/format.js';

export default async function render({ view }) {
  const loans = await libraryApi.mine();
  const out = loans.filter(l => l.status === 'issued');

  mount(view, html`
    ${pageHeader('Library', 'Your borrowed books and due dates.')}
    <div class="card" style="margin-bottom:16px"><div class="card-title">Library — ${out.length} book${out.length === 1 ? '' : 's'} on loan</div>
      ${loans.length ? dataTable([
        { label: 'Book', render: l => html`<span class="cell-strong">${l.book ? l.book.title : ''}</span><div class="small muted">${l.book ? l.book.author : ''} ${l.copy ? `· ${l.copy.accessionNo}` : ''}</div>` },
        { label: 'Issued', render: l => formatDate(l.issuedOn) },
        { label: 'Due', render: l => html`${formatDate(l.dueDate)}${l.overdue ? html` <span class="text-red small">${l.daysOverdue} day${l.daysOverdue === 1 ? '' : 's'} late</span>` : ''}` },
        { label: 'Status', render: l => (l.overdue ? badge('red', 'Overdue') : statusPill(l.status)) },
        { label: 'Fine', cls: 'right', render: l => (l.fineNowPaise ? formatMoney(l.fineNowPaise) : '—') }
      ], loans) : emptyState('You have not borrowed any books.')}
      <div class="card-pad small muted">A fine for a late return is added to your fees as a separate charge and paid under Fees &amp; Payments.</div>
    </div>`);
}
