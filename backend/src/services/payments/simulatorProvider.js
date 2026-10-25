const crypto = require('crypto');
const { badRequest, notFound } = require('../../utils/errors');

const hex = n => crypto.randomBytes(n).toString('hex');

/**
 * SANDBOX SIMULATOR — NOT A REAL PAYMENT GATEWAY.
 *
 * It exists so the complete order -> pay -> verify -> receipt flow can be exercised in
 * development and automated tests without gateway credentials. It never touches a card
 * network or moves money. Every payment created through it is stored with simulated=true,
 * shown as "SIMULATED" in the UI and printed on the receipt, and the provider refuses
 * to load when NODE_ENV=production (see config/env.js). Orders live in process memory.
 */
function createSimulatorProvider() {
  const secret = hex(32);
  const orders = new Map();    // orderId -> { amountPaise, currency }
  const payments = new Map();  // paymentId -> payment
  const refunds = new Map();   // idempotency key -> refund

  const sign = (orderId, paymentId) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

  return {
    name: 'simulator',
    simulated: true,
    keyId: 'simulator',
    publicConfig: () => ({ provider: 'simulator', keyId: 'simulator', simulated: true }),

    async createOrder({ amountPaise, currency }) {
      const id = `order_sim_${hex(8)}`;
      orders.set(id, { amountPaise, currency });
      return { id, amountPaise, currency };
    },

    /** Stands in for the customer completing (or abandoning) the gateway checkout. */
    simulatePay(orderId, outcome) {
      const order = orders.get(orderId);
      if (!order) throw notFound('Unknown simulated order (the server may have restarted).');
      if (!['success', 'failure', 'authorized'].includes(outcome)) throw badRequest('Unknown outcome.');
      const id = `pay_sim_${hex(8)}`;
      const status = outcome === 'success' ? 'captured' : outcome === 'authorized' ? 'authorized' : 'failed';
      const p = { id, orderId, amountPaise: order.amountPaise, currency: order.currency, status, failureReason: status === 'failed' ? 'Simulated payment failure' : '' };
      payments.set(id, p);
      return { paymentId: id, signature: sign(orderId, id), status };
    },

    verifyPaymentSignature({ orderId, paymentId, signature }) {
      const a = Buffer.from(sign(orderId, paymentId)); const b = Buffer.from(String(signature || ''));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    async fetchPayment(paymentId) {
      const p = payments.get(paymentId);
      if (!p) throw notFound('Unknown simulated payment.');
      return { ...p };
    },

    async fetchOrderPayments(orderId) {
      return [...payments.values()].filter(p => p.orderId === orderId).map(p => ({ ...p }));
    },

    /** Refunds complete immediately in the sandbox. The same idempotency key always returns the same refund. */
    async refundPayment({ paymentId, amountPaise, idempotencyKey }) {
      if (!String(paymentId || '').startsWith('pay_sim_')) throw badRequest('Not a simulated payment.');
      if (!refunds.has(idempotencyKey)) refunds.set(idempotencyKey, { id: `rfnd_sim_${hex(8)}`, paymentId, amountPaise, status: 'processed' });
      return { ...refunds.get(idempotencyKey) };
    },

    async fetchRefund(refundId) {
      const r = [...refunds.values()].find(x => x.id === refundId);
      if (!r) throw notFound('Unknown simulated refund.');
      return { ...r };
    },

    verifyWebhook: () => false,
    parseWebhook: () => null
  };
}

module.exports = { createSimulatorProvider };
