const { config } = require('../config/env');
const smsProvider = require('../services/notify/smsProvider');
const delivery = require('../services/deliveryService');
const logger = require('../utils/logger');

/**
 * SMS delivery receipts. Only a correctly signed callback can move a delivery to "delivered"/"failed";
 * "sent" alone never means delivered.
 */
exports.smsStatus = async (req, res) => {
  try {
    const provider = smsProvider.get();
    const url = `${config.appBaseUrl}/api/notifications/sms-status`;
    if (!provider.verifyStatusCallback(url, req.body || {}, req.get('x-twilio-signature'))) {
      return res.status(403).json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } });
    }
    const status = provider.mapStatus(req.body.MessageStatus);
    if (status && req.body.MessageSid) await delivery.applyProviderStatus(req.body.MessageSid, status);
    res.status(204).end();
  } catch (err) {
    logger.error('sms status callback failed', { error: err.message });
    res.status(500).json({ error: { code: 'WEBHOOK_ERROR', message: 'Could not process the callback.' } });
  }
};
