const crypto = require('crypto');
const { AppError } = require('../../utils/errors');

const API = 'https://api.razorpay.com/v1';

const hmac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8'); const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const mapStatus = s => (s === 'captured' ? 'captured' : s === 'authorized' ? 'authorized' : s === 'failed' ? 'failed' : 'created');

const toRefund = r => ({
  id: r.id, paymentId: r.payment_id, amountPaise: r.amount,
  status: r.status === 'processed' ? 'processed' : r.status === 'failed' ? 'failed' : 'pending'
});

const toPayment = p => ({
  id: p.id, orderId: p.order_id, amountPaise: p.amount, currency: p.currency,
  status: mapStatus(p.status), failureReason: p.error_description || ''
});

/**
 * Razorpay integration over its REST API (no SDK needed).
 *  - orders are created server side with a server computed amount
 *  - the checkout signature is HMAC_SHA256(orderId|paymentId, key_secret)
 *  - the payment is re-fetched from Razorpay so amount/status never come from the browser
 *  - webhooks are verified with HMAC_SHA256(rawBody, webhook_secret)
 * `fetchImpl` is injectable for tests.
 */
function createRazorpayProvider({ keyId, keySecret, webhookSecret }, fetchImpl = fetch) {
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  async function call(method, path, body, extraHeaders = {}) {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        method, headers: { Authorization: auth, 'Content-Type': 'application/json', ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      throw new AppError(502, 'GATEWAY_UNREACHABLE', 'The payment gateway could not be reached. Please try again.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AppError(502, 'GATEWAY_ERROR', (json.error && json.error.description) || 'The payment gateway rejected the request.');
    }
    return json;
  }

  return {
    name: 'razorpay',
    simulated: false,
    keyId,
    publicConfig: () => ({ provider: 'razorpay', keyId, simulated: false }),

    async createOrder({ amountPaise, currency, receipt, notes }) {
      const o = await call('POST', '/orders', { amount: amountPaise, currency, receipt: receipt.slice(0, 40), notes });
      return { id: o.id, amountPaise: o.amount, currency: o.currency };
    },

    verifyPaymentSignature({ orderId, paymentId, signature }) {
      return safeEqualHex(hmac(keySecret, `${orderId}|${paymentId}`), signature);
    },

    async fetchPayment(paymentId) {
      return toPayment(await call('GET', `/payments/${encodeURIComponent(paymentId)}`));
    },

    async fetchOrderPayments(orderId) {
      const res = await call('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
      return (res.items || []).map(toPayment);
    },

    /** Asks the gateway to refund part of a captured payment. The idempotency key makes a retry safe. */
    async refundPayment({ paymentId, amountPaise, idempotencyKey, notes }) {
      return toRefund(await call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`,
        { amount: amountPaise, speed: 'normal', receipt: String(idempotencyKey).slice(0, 40), notes }, { 'X-Refund-Idempotency': String(idempotencyKey) }));
    },

    async fetchRefund(refundId) {
      return toRefund(await call('GET', `/refunds/${encodeURIComponent(refundId)}`));
    },

    verifyWebhook(rawBody, headers) {
      if (!webhookSecret) return false;
      return safeEqualHex(hmac(webhookSecret, rawBody), headers['x-razorpay-signature']);
    },

    /** Normalizes a (verified) webhook body to { eventId, kind, orderId, paymentId, amountPaise, reason } (or a refund_* event with refundId). */
    parseWebhook(rawBody, headers) {
      const body = JSON.parse(rawBody.toString('utf8'));
      const refund = body.payload && body.payload.refund && body.payload.refund.entity;
      if (refund && ['refund.processed', 'refund.failed'].includes(body.event)) {
        return { eventId: headers['x-razorpay-event-id'] || null, kind: body.event === 'refund.processed' ? 'refund_processed' : 'refund_failed', refundId: refund.id, paymentId: refund.payment_id, amountPaise: refund.amount };
      }
      const entity = body.payload && body.payload.payment && body.payload.payment.entity;
      if (!entity) return null;
      const kinds = { 'payment.captured': 'success', 'order.paid': 'success', 'payment.failed': 'failed', 'payment.authorized': 'pending' };
      const kind = kinds[body.event];
      if (!kind) return null;
      return {
        eventId: headers['x-razorpay-event-id'] || null, kind, orderId: entity.order_id, paymentId: entity.id,
        amountPaise: entity.amount, reason: entity.error_description || ''
      };
    }
  };
}

module.exports = { createRazorpayProvider };
