/** In-memory stand-ins for external providers; they record what would have been sent. */
function installFakeProviders() {
  const email = require('../../src/services/notify/emailProvider');
  const sms = require('../../src/services/notify/smsProvider');
  const box = { emails: [], sms: [], failEmail: 0, failSms: 0 };

  email.setProviderForTests({
    name: 'fake-email', isConfigured: () => true,
    async send(msg) {
      if (box.failEmail > 0) { box.failEmail -= 1; throw new Error('smtp down'); }
      box.emails.push(msg);
      return { messageId: `e${box.emails.length}` };
    }
  });
  sms.setProviderForTests({
    name: 'fake-sms', isConfigured: () => true,
    async send(msg) {
      if (box.failSms > 0) { box.failSms -= 1; throw new Error('sms gateway down'); }
      box.sms.push(msg);
      return { messageId: `SM${box.sms.length}` };
    },
    verifyStatusCallback: (url, params, sig) => sig === 'valid-signature',
    mapStatus: s => ({ delivered: 'delivered', failed: 'failed', undelivered: 'failed' }[s] || null)
  });
  return box;
}

function removeFakeProviders() {
  require('../../src/services/notify/emailProvider').setProviderForTests(null);
  require('../../src/services/notify/smsProvider').setProviderForTests(null);
}

/** Extracts the reset token from the e-mailed link. */
const tokenFrom = body => (/#token=([A-Za-z0-9_-]+)/.exec(body) || [])[1];

module.exports = { installFakeProviders, removeFakeProviders, tokenFrom };
