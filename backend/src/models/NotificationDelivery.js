const mongoose = require('mongoose');

/**
 * Delivery attempt record per notification and channel.
 *  queued -> sent (accepted by the provider) -> delivered (only when the provider confirms)
 *  queued -> failed (after the maximum attempts) | skipped (no provider/address/opt-out; never claimed as sent)
 */
const deliverySchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  notification: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', default: null },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channel: { type: String, enum: ['email', 'sms'], required: true },
  // e.g. 'password_reset' for direct transactional mail that has no in-app notification
  purpose: { type: String, default: '' },
  status: { type: String, enum: ['queued', 'sending', 'sent', 'delivered', 'failed', 'skipped'], default: 'queued' },
  provider: { type: String, default: '' },
  providerMessageId: { type: String, default: '' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lastError: { type: String, default: '' },
  reason: { type: String, default: '' },
  sentAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null }
}, { timestamps: true });

deliverySchema.index(
  { notification: 1, channel: 1 },
  { unique: true, partialFilterExpression: { notification: { $type: 'objectId' } } }
);
deliverySchema.index({ status: 1, nextAttemptAt: 1 });
deliverySchema.index({ providerMessageId: 1 });
deliverySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationDelivery', deliverySchema);
