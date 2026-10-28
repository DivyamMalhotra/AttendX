const { Notification, User, College } = require('../models');
const { config } = require('../config/env');
const { isDuplicateKey } = require('../utils/mongoErrors');
const delivery = require('./deliveryService');
const live = require('./liveService');
const logger = require('../utils/logger');
const { ROLES, NOTIFICATION_TYPES: T } = require('../config/constants');

const STUDENT_ONLY_TYPES = new Set([
  T.ATTENDANCE_SHORTAGE, T.ATTENDANCE_RECOVERED, T.DUTY_LEAVE, T.PAYMENT, T.FEE_REMINDER, T.LATE_FEE, T.REFUND,
  T.ASSIGNMENT, T.EXAM, T.RESULT, T.LIBRARY, T.MENTOR
]);

/**
 * The single entry point for telling a user something. It
 *  1. stores the in-app notification (once per user + dedupeKey, so repeating an event is harmless),
 *  2. pushes a content-free live event so open browser tabs refresh,
 *  3. queues e-mail / SMS deliveries according to college policy and the user's preferences.
 * Returns the created notification, or null when this event was already recorded.
 *
 * `context` may carry already-loaded { user, college } documents (bulk fan-out) to avoid repeated reads.
 */
async function notify({ collegeId, userId, type, title, message, data = {}, dedupeKey, link = '', force }, context = {}) {
  // Routing rule: student-facing events (fees, assignments, results, library, attendance standing, leave decisions) are
  // never stored for a teacher or any other non-student account, whatever caller raised them.
  if (STUDENT_ONLY_TYPES.has(type)) {
    const recipient = context.user || await User.findById(userId).select('role').lean();
    if (!recipient || recipient.role !== ROLES.STUDENT) return null;
  }
  let doc;
  try {
    doc = await Notification.create({ college: collegeId, user: userId, type, title, message, data, dedupeKey, link });
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }

  // Live push and external channels must never make the business operation fail.
  try {
    await live.publish(userId, 'notification', { id: String(doc._id), kind: type });
    const [user, college] = await Promise.all([
      context.user || User.findById(userId).select('name email phone notificationPrefs').lean(),
      context.college || College.findById(collegeId).select('name settings')
    ]);
    if (user && college) {
      await delivery.queue({ notification: doc, user, college, force });
      if (!config.isTest) setImmediate(() => delivery.processQueue({ limit: 5 }).catch(e => logger.error('inline delivery failed', { error: e.message })));
    }
  } catch (err) {
    logger.error('notification side effects failed', { type, error: err.message });
  }
  return doc;
}

/** Rewrites an existing notification's text/data without re-notifying the user. */
const refresh = (userId, dedupeKey, { message, data }) =>
  Notification.updateOne({ user: userId, dedupeKey }, { $set: { message, data } });

async function list(userId, { unreadOnly = false, skip = 0, limit = 30 } = {}) {
  const filter = { user: userId, ...(unreadOnly ? { read: false } : {}) };
  const [total, unread, rows] = await Promise.all([
    Notification.countDocuments({ user: userId }),
    Notification.countDocuments({ user: userId, read: false }),
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
  ]);
  return { total, unread, rows };
}

const unreadCount = userId => Notification.countDocuments({ user: userId, read: false });

const markRead = (userId, id) =>
  Notification.updateOne({ _id: id, user: userId, read: false }, { $set: { read: true, readAt: new Date() } });

const markAllRead = userId =>
  Notification.updateMany({ user: userId, read: false }, { $set: { read: true, readAt: new Date() } });

module.exports = { STUDENT_ONLY_TYPES, notify, refresh, list, unreadCount, markRead, markAllRead };
