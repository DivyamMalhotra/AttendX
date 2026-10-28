const mongoose = require('mongoose');
const { preventDeletion, preventUpdates } = require('./plugins');

const auditLogSchema = new mongoose.Schema({
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College', index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, default: 'system' },
  actorRole: { type: String, default: 'system' },
  action: { type: String, required: true },
  entityType: { type: String, default: '' },
  entityId: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' }
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ college: 1, createdAt: -1 });
auditLogSchema.index({ college: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

preventDeletion(auditLogSchema, 'An audit log entry');
preventUpdates(auditLogSchema, 'An audit log entry');

module.exports = mongoose.model('AuditLog', auditLogSchema);
