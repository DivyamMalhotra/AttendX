import { html, mount, $, $$, delegate } from '../utils/dom.js';
import { feesApi } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';
import { openModal } from '../components/modal.js';
import { readForm } from '../components/forms.js';
import { icons } from '../components/icons.js';
import { notice } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { formatMoney, parseRupees, formatDate } from '../utils/format.js';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_SRC;
    s.onload = resolve;
    s.onerror = () => reject(new Error('The payment window could not be loaded. Check your connection.'));
    document.head.appendChild(s);
  });
}

/* ------------------------------------------------------------------ result views */

function resultView(payment) {
  if (payment.status === 'success') {
    return html`<div class="confirm-screen">
      <div class="confirm-icon">${icons.check}</div>
      <h2>Payment successful</h2>
      <p>${formatMoney(payment.amountPaise)} received${payment.simulated ? ' (simulated test payment)' : ''}.</p>
      ${payment.needsReview
        ? notice('warning', 'Needs administrator review', 'Your payment was verified but could not be applied automatically. The college office will reconcile it; no receipt is issued until then.')
        : html`<dl class="kv" style="text-align:left;max-width:360px;margin:0 auto 18px">
            <dt>Receipt no.</dt><dd>${payment.receiptNo || 'Being generated…'}</dd>
            <dt>Transaction ID</dt><dd class="small">${payment.id}</dd>
            <dt>Balance now</dt><dd>${payment.balanceAfterPaise === null ? '—' : formatMoney(payment.balanceAfterPaise)}</dd></dl>`}
    </div>`;
  }
  if (payment.status === 'pending') {
    return html`<div class="confirm-screen"><div class="confirm-icon pending">${icons.clock}</div>
      <h2>Payment is being confirmed</h2>
      <p>The bank has not confirmed this payment yet. Nothing has been added to your fee record. Check again in a few minutes — a receipt is issued only after the payment is verified.</p></div>`;
  }
  if (payment.status === 'failed' || payment.status === 'cancelled') {
    return html`<div class="confirm-screen"><div class="confirm-icon failed">${icons.x}</div>
      <h2>Payment ${payment.status === 'failed' ? 'failed' : 'cancelled'}</h2>
      <p>${payment.failureReason || 'No money was taken and your fee balance is unchanged.'}</p></div>`;
  }
  return html`<div class="confirm-screen"><div class="confirm-icon pending">${icons.clock}</div><h2>Payment not completed yet</h2>
    <p>If you were charged, use “Check status” in Payment History in a few minutes.</p></div>`;
}

function showResult(modalEl, payment, { onDone, close }) {
  const body = $('.modal-body', modalEl);
  mount(body, html`${resultView(payment)}<div class="field-error modal-error" role="alert" hidden></div>`);
  const footer = $('.modal-footer', modalEl);
  mount(footer, html`
    ${payment.status === 'pending' ? html`<button type="button" class="btn btn-outline" data-act="sync">Check status</button>` : ''}
    ${payment.status === 'success' && payment.receiptNo ? html`<button type="button" class="btn btn-outline" data-act="receipt">${icons.download} Download receipt</button>` : ''}
    <button type="button" class="btn btn-primary" data-act="done">Done</button>`);
  delegate(footer, 'click', '[data-act]', async (e, btn) => {
    if (btn.dataset.act === 'done') { close(); onDone(); return; }
    btn.disabled = true;
    try {
      if (btn.dataset.act === 'sync') showResult(modalEl, await feesApi.sync(payment.orderId), { onDone, close });
      if (btn.dataset.act === 'receipt') {
        const history = await feesApi.history();
        const row = history.transactions.find(t => t.providerOrderId === payment.orderId);
        if (row && row.receiptId) await feesApi.receipt(row.receiptId); else toast('Receipt is not ready yet.', 'error');
      }
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
}

/* ------------------------------------------------------------------ gateways */

/** Simulator gateway: clearly labelled, no real money. Resolves with the final payment object. */
function simulatorGateway(modalEl, checkout, order) {
  return new Promise(resolve => {
    const body = $('.modal-body', modalEl);
    mount(body, html`
      <div class="sim-panel">
        <div class="notice-title">SIMULATED PAYMENT — no real money moves</div>
        <p class="small" style="margin:6px 0 0">This server is running the payment <b>simulator</b> (development mode). Choose what the pretend bank should do for ${formatMoney(checkout.amountPaise)}.</p>
        <div class="sim-actions">
          <button type="button" class="btn btn-success" data-out="success">Simulate successful payment</button>
          <button type="button" class="btn btn-outline" data-out="authorized">Simulate pending payment</button>
          <button type="button" class="btn btn-danger-soft" data-out="failure">Simulate failed payment</button>
          <button type="button" class="btn btn-ghost" data-out="cancel">Close without paying</button>
        </div>
      </div><div class="field-error modal-error" role="alert" hidden></div>`);
    $('.modal-footer', modalEl).style.display = 'none';
    delegate(body, 'click', '[data-out]', async (e, btn) => {
      $$('[data-out]', body).forEach(b => { b.disabled = true; });
      try {
        if (btn.dataset.out === 'cancel') { resolve(await feesApi.cancel(order.payment.orderId)); return; }
        const sim = await feesApi.simulate(order.payment.orderId, btn.dataset.out);
        resolve(await feesApi.verify(order.payment.orderId, { paymentId: sim.paymentId, signature: sim.signature }));
      } catch (err) {
        $$('[data-out]', body).forEach(b => { b.disabled = false; });
        const box = $('.modal-error', body); box.textContent = err.message; box.hidden = false;
      }
    });
  });
}

async function razorpayGateway(checkout, order, college) {
  await loadCheckoutScript();
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      key: checkout.keyId, order_id: checkout.orderId, amount: checkout.amountPaise, currency: checkout.currency,
      name: college, description: 'Semester fee', prefill: checkout.prefill,
      handler: async response => {
        try {
          resolve(await feesApi.verify(checkout.orderId, { paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }));
        } catch (err) { reject(err); }
      },
      modal: { ondismiss: async () => { try { resolve(await feesApi.sync(checkout.orderId)); } catch (e) { reject(e); } } }
    });
    rz.on('payment.failed', async () => { try { resolve(await feesApi.sync(checkout.orderId)); } catch (e) { reject(e); } });
    rz.open();
  });
}

/* ------------------------------------------------------------------ entry point */

/**
 * "Pay Semester Fees": confirm what is owed, pick full/partial amount, pay, then show the verified result.
 * The amount sent to the server is only a request — the server recomputes and enforces the outstanding balance.
 */
export function startPayment({ fee, partialAllowed, collegeName, onDone }) {
  const outstanding = fee.outstandingPaise;
  const modal = openModal({
    title: 'Pay Semester Fees',
    confirmText: 'Continue to payment',
    body: html`
      <div class="pay-summary">
        <div class="row"><span>Academic session</span><span>${fee.academicSession?.name || '—'}</span></div>
        <div class="row"><span>${fee.category && fee.category !== 'semester' ? 'Charge' : 'Semester'}</span><span>${fee.category && fee.category !== 'semester' ? (fee.description || fee.category) : `Semester ${fee.semesterNumber}`}</span></div>
        <div class="row"><span>${fee.category && fee.category !== 'semester' ? 'Total amount' : 'Total semester fee'}</span><span>${formatMoney(fee.totalPayablePaise)}</span></div>
        <div class="row"><span>Already paid</span><span>${formatMoney(fee.paidPaise)}</span></div>
        <div class="row"><span>Outstanding amount</span><span>${formatMoney(outstanding)}</span></div>
      </div>
      ${fee.dueDate ? html`<p class="small muted" style="margin-top:-6px">Due by ${formatDate(fee.dueDate)}</p>` : ''}
      <form>
        <label class="radio-card"><input type="radio" name="mode" value="full" checked><span><b>Pay full outstanding</b><br><span class="small muted">${formatMoney(outstanding)}</span></span></label>
        ${partialAllowed ? html`<label class="radio-card"><input type="radio" name="mode" value="part"><span style="flex:1"><b>Pay a part now</b>
          <div class="field" style="margin:8px 0 0"><div class="input-prefix"><span>₹</span><input type="text" name="amount" inputmode="decimal" placeholder="e.g. 25000" aria-label="Amount in rupees" disabled></div>
          <div class="field-hint">Between ₹1 and ${formatMoney(outstanding)}. The rest stays outstanding.</div></div></span></label>` : ''}
        <p class="small muted">Payment methods (cards, UPI, net banking, wallets) are offered by the payment gateway on the next step. AttendX never sees or stores your card or bank details.</p>
      </form>`,
    onOpen(el) {
      const amount = $('[name=amount]', el);
      $$('[name=mode]', el).forEach(r => r.addEventListener('change', () => {
        if (amount) { amount.disabled = r.value !== 'part' || !r.checked; if (!amount.disabled) amount.focus(); }
      }));
    },
    async onConfirm(el, { showError, close }) {
      const v = readForm(el);
      const body = { assignmentId: fee.id };
      if (v.mode === 'part') {
        const paise = parseRupees(v.amount);
        if (paise === null || paise < 100) { showError('Enter a valid amount of at least ₹1.'); return false; }
        if (paise > outstanding) { showError(`The amount cannot exceed ${formatMoney(outstanding)}.`); return false; }
        body.amountPaise = paise;
      }
      let order;
      try {
        order = await feesApi.createOrder(body);
      } catch (err) {
        if (err instanceof ApiError) { showError(err.message); return false; }
        throw err;
      }
      // Keep this dialog open and reuse it for the gateway and the result.
      runGateway(el, order, collegeName, { onDone, close });
      return false;
    }
  });
}

async function runGateway(modalEl, order, collegeName, { onDone, close }) {
  const { checkout } = order;
  try {
    mount($('.modal-body', modalEl), html`<div class="confirm-screen"><div class="spinner" style="width:28px;height:28px"></div><p class="mt-12">Opening secure payment…</p></div>`);
    const payment = checkout.simulated
      ? await simulatorGateway(modalEl, checkout, order)
      : await razorpayGateway(checkout, order, collegeName);
    showResult(modalEl, payment, { onDone, close });
  } catch (err) {
    mount($('.modal-body', modalEl), html`<div class="confirm-screen"><div class="confirm-icon failed">${icons.x}</div><h2>Payment could not be completed</h2><p>${err.message}</p></div>`);
    mount($('.modal-footer', modalEl), html`<button type="button" class="btn btn-primary" data-act="close">Close</button>`);
    $('[data-act=close]', modalEl).addEventListener('click', () => { close(); onDone(); });
  }
}
