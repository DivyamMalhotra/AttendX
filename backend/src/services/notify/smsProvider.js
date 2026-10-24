const crypto = require('crypto');
const { config } = require('../../config/env');
const { AppError } = require('../../utils/errors');

/**
 * SMS provider interface: send({ to, body }) -> { messageId }, plus verifyStatusCallback(url, params, signature).
 * Twilio is implemented over its REST API (no SDK). Replacing it means adding another object with this shape
 * and registering it in `providers`; the notification system does not change.
 */
let override = null;

const twilio = {
  name: 'twilio',
  isConfigured: () => Boolean(config.sms.twilio.accountSid && config.sms.twilio.authToken && config.sms.twilio.from),

  async send({ to, body }, fetchImpl = fetch) {
    const { accountSid, authToken, from } = config.sms.twilio;
    const form = new URLSearchParams({ To: to, From: from, Body: body, StatusCallback: `${config.appBaseUrl}/api/notifications/sms-status` });
    let res;
    try {
      res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
      });
    } catch (e) {
      throw new AppError(502, 'SMS_UNREACHABLE', 'The SMS provider could not be reached.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(502, 'SMS_REJECTED', json.message || `SMS provider error ${res.status}`);
    return { messageId: json.sid || '' };
  },

  /** Twilio signs callbacks with HMAC-SHA1(authToken, url + sorted key/value pairs). */
  verifyStatusCallback(url, params, signature) {
    const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
    const expected = crypto.createHmac('sha1', config.sms.twilio.authToken || '').update(Buffer.from(data, 'utf8')).digest('base64');
    const a = Buffer.from(expected); const b = Buffer.from(String(signature || ''));
    return Boolean(config.sms.twilio.authToken) && a.length === b.length && crypto.timingSafeEqual(a, b);
  },
  /** Maps provider status words to ours; anything non-final is ignored. */
  mapStatus: s => ({ delivered: 'delivered', undelivered: 'failed', failed: 'failed' }[s] || null)
};

const none = { name: 'none', isConfigured: () => false, send: async () => { throw new Error('No SMS provider configured.'); }, verifyStatusCallback: () => false, mapStatus: () => null };
const providers = { twilio, none };

const current = () => override || providers[config.sms.provider] || none;

module.exports = {
  get: current,
  isConfigured: () => current().isConfigured(),
  setProviderForTests: p => { override = p; },
  twilio
};
