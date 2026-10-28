const { NotificationDelivery, Notification, User, College } = require('../models');
const { config } = require('../config/env');
const { NOTIFICATION_CATALOG } = require('../config/constants');
const { renderEmail, renderSms } = require('../templates/notificationTemplates');
const emailProvider = require('./notify/emailProvider');
const smsProvider = require('./notify/smsProvider');
const logger = require('../utils/logger');

const BACKOFF_MIN = attempt => Math.min(60, 2 ** attempt);   // 2, 4, 8, 16, 32, 60 minutes
const STUCK_AFTER_MS = 10 * 60 * 1000;

/** Which channels a notification should use, given college policy, the event type and the user's preferences. */
function chooseChannels({ type, settings, user, force = {} }) {
  const cat = NOTIFICATION_CATALOG[type] || NOTIFICATION_CATALOG.system;
  const override = settings.notifications && (settings.notifications.get ? settings.notifications.get(type) : settings.notifications[type]);
  const prefs = user.notificationPrefs || {};
  const email = (force.email ?? override?.email ?? cat.email) && (cat.mandatory || prefs.email !== false);
  const sms = Boolean(settings.smsEnabled) && (force.sms ?? override?.sms ?? cat.sms) && (cat.mandatory || prefs.sms !== false);
  return { email: Boolean(email), sms: Boolean(sms) };
}

/**
 * Creates one delivery record per wanted channel. Nothing is ever recorded as "sent" here:
 * a channel without a provider or address is stored as "skipped" with the reason, so the history is honest.
 */
async function queue({ notification, user, college, force }) {
  const wanted = chooseChannels({ type: notification.type, settings: college.settings, user, force });
  const rows = [];
  const base = { college: college._id, notification: notification._id, user: user._id };
  if (wanted.email) {
    if (!user.email) rows.push({ ...base, channel: 'email', status: 'skipped', reason: 'no e-mail address' });
    else if (!emailProvider.isConfigured()) rows.push({ ...base, channel: 'email', status: 'skipped', reason: 'e-mail provider not configured' });
    else rows.push({ ...base, channel: 'email', status: 'queued', provider: emailProvider.get().name });
  }
  if (wanted.sms) {
    if (!user.phone) rows.push({ ...base, channel: 'sms', status: 'skipped', reason: 'no phone number' });
    else if (!smsProvider.isConfigured()) rows.push({ ...base, channel: 'sms', status: 'skipped', reason: 'SMS provider not configured' });
    else rows.push({ ...base, channel: 'sms', status: 'queued', provider: smsProvider.get().name });
  }
  if (!rows.length) return [];
  try {
    return await NotificationDelivery.insertMany(rows, { ordered: false });
  } catch (err) {
    if (err.code === 11000 || (err.writeErrors || []).every(e => e.code === 11000)) return []; // already queued for this notification
    throw err;
  }
}

/** Sends one claimed delivery through its provider. Returns the update to store. */
async function attempt(delivery) {
  const [notification, user] = await Promise.all([
    delivery.notification ? Notification.findById(delivery.notification).lean() : null,
    User.findById(delivery.user).lean()
  ]);
  if (!notification || !user) return { status: 'skipped', reason: 'recipient or notification no longer exists' };
  const college = await College.findById(delivery.college).select('name').lean();

  if (delivery.channel === 'email') {
    const msg = renderEmail(notification, { user, collegeName: college ? college.name : 'AttendX' });
    const out = await emailProvider.get().send({ to: user.email, ...msg });
    return { status: 'sent', provider: emailProvider.get().name, providerMessageId: out.messageId || '', sentAt: new Date() };
  }
  const out = await smsProvider.get().send({ to: user.phone, body: renderSms(notification) });
  return { status: 'sent', provider: smsProvider.get().name, providerMessageId: out.messageId || '', sentAt: new Date() };
}

/**
 * Works through queued deliveries: claim -> send -> record. Failures are retried with growing back-off up
 * to the configured maximum, then marked failed with the last error. Safe to run on several instances
 * (a delivery is claimed atomically) and to re-run.
 */
async function processQueue({ limit = 50, now = new Date() } = {}) {
  await NotificationDelivery.updateMany(
    { status: 'sending', updatedAt: { $lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    { $set: { status: 'queued', nextAttemptAt: now } }
  );
  const stats = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < limit; i += 1) {
    const claimed = await NotificationDelivery.findOneAndUpdate(
      { status: 'queued', nextAttemptAt: { $lte: now } },
      { $set: { status: 'sending' }, $inc: { attempts: 1 } },
      { returnDocument: 'after', sort: { nextAttemptAt: 1 } }
    );
    if (!claimed) break;
    try {
      const result = await attempt(claimed);
      await NotificationDelivery.updateOne({ _id: claimed._id }, { $set: { ...result, lastError: '' } });
      stats[result.status === 'sent' ? 'sent' : 'skipped'] += 1;
    } catch (err) {
      const final = claimed.attempts >= config.notifications.maxAttempts;
      await NotificationDelivery.updateOne({ _id: claimed._id }, {
        $set: {
          status: final ? 'failed' : 'queued', lastError: String(err.message).slice(0, 300),
          nextAttemptAt: new Date(now.getTime() + BACKOFF_MIN(claimed.attempts) * 60000)
        }
      });
      logger.warn('notification delivery failed', { channel: claimed.channel, attempts: claimed.attempts, final, error: err.message });
      stats[final ? 'failed' : 'retried'] += 1;
    }
  }
  return stats;
}

/**
 * Direct transactional e-mail (password reset). The message content, which contains a secret link,
 * is rendered by the caller and sent immediately; only the outcome is stored, never the content.
 */
async function sendDirectEmail({ user, collegeId, purpose, message }) {
  const row = await NotificationDelivery.create({
    college: collegeId, notification: null, user: user._id, channel: 'email', purpose, status: 'sending', attempts: 1,
    provider: emailProvider.get().name
  });
  if (!emailProvider.isConfigured()) {
    await NotificationDelivery.updateOne({ _id: row._id }, { $set: { status: 'skipped', reason: 'e-mail provider not configured' } });
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const out = await emailProvider.get().send({ to: user.email, ...message });
    await NotificationDelivery.updateOne({ _id: row._id }, { $set: { status: 'sent', providerMessageId: out.messageId || '', sentAt: new Date() } });
    return { sent: true };
  } catch (err) {
    await NotificationDelivery.updateOne({ _id: row._id }, { $set: { status: 'failed', lastError: String(err.message).slice(0, 300) } });
    logger.error('transactional e-mail failed', { purpose, error: err.message });
    return { sent: false, reason: 'failed' };
  }
}

/** Provider confirmation (SMS status callback): the only way a delivery becomes "delivered". */
async function applyProviderStatus(providerMessageId, status) {
  const set = status === 'delivered' ? { status: 'delivered', deliveredAt: new Date() } : { status: 'failed', lastError: 'reported undelivered by provider' };
  return NotificationDelivery.updateOne({ providerMessageId, status: { $in: ['sent', 'delivered'] } }, { $set: set });
}

module.exports = { chooseChannels, queue, processQueue, sendDirectEmail, applyProviderStatus };
