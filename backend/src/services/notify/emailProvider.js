const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { config } = require('../../config/env');

/**
 * E-mail provider interface: send({ to, subject, text, html }) -> { messageId }.
 *  - smtp    real delivery through any SMTP server (Nodemailer)
 *  - outbox  development only: writes each message to ./outbox so flows can be tried without a mail server
 *  - none    nothing configured: callers record the delivery as "skipped", never as sent
 * Another provider (SES API, SendGrid...) is one more object with the same shape.
 */
let override = null;
let smtp = null;

function smtpTransport() {
  if (!smtp) {
    const { host, port, secure, user, pass } = config.email.smtp;
    smtp = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined });
  }
  return smtp;
}

const providers = {
  smtp: {
    name: 'smtp',
    isConfigured: () => Boolean(config.email.smtp.host),
    async send({ to, subject, text, html }) {
      const info = await smtpTransport().sendMail({ from: config.email.from, to, subject, text, html });
      return { messageId: info.messageId || '' };
    }
  },
  outbox: {
    name: 'outbox',
    isConfigured: () => !config.isProd,
    async send({ to, subject, text, html }) {
      const dir = path.join(process.cwd(), 'outbox');
      fs.mkdirSync(dir, { recursive: true });
      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ to, subject, text, html, from: config.email.from }, null, 2));
      return { messageId: `outbox-${id}` };
    }
  },
  none: { name: 'none', isConfigured: () => false, send: async () => { throw new Error('No e-mail provider configured.'); } }
};

const current = () => override || providers[config.email.provider] || providers.none;

module.exports = {
  get: current,
  isConfigured: () => current().isConfigured(),
  /** Test hook: inject a fake provider object (or null to restore). */
  setProviderForTests: p => { override = p; }
};
