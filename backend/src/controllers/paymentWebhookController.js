const payments = require('../services/paymentService');
const logger = require('../utils/logger');

/**
 * Provider webhook endpoint. The body arrives as the raw bytes the gateway signed
 * (see app.js), is verified before anything else, and the handler is idempotent so
 * gateway retries and duplicate deliveries are harmless.
 */
exports.handle = async (req, res) => {
  try {
    const result = await payments.handleWebhook(req.body, req.headers);
    if (result === 'invalid_signature') return res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } });
    res.status(200).json({ data: { result } });
  } catch (err) {
    logger.error('Webhook processing failed', { error: err.message });
    // 5xx makes the gateway retry later, which is what we want for transient failures.
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: { code: err.code || 'WEBHOOK_ERROR', message: 'Webhook could not be processed.' } });
  }
};
