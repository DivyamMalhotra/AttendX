const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../config/constants');

const notificationSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
  // optional in-app deep link (a hash route such as #payments)
  link: { type: String, maxlength: 200, default: '' },
  title: { type: String, required: true, maxlength: 160 },
  message: { type: String, required: true, maxlength: 600 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Idempotency key: the same event can be raised any number of times but stored once.
  dedupeKey: { type: String },
  read: { type: Boolean, default: false },
  readAt: { type: Date, default: null }
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index(
  { user: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

module.exports = mongoose.model('Notification', notificationSchema);
