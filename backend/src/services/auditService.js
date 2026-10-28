const { AuditLog } = require('../models');
const logger = require('../utils/logger');

/**
 * Appends an audit entry. Auditing must never break the business operation it describes,
 * so failures are logged and swallowed.
 *  actor: a User document (or null for system actions)
 */
async function record({ actor = null, collegeId, action, entityType = '', entityId = '', meta = {}, ip = '' }) {
  try {
    await AuditLog.create({
      college: collegeId || (actor && actor.college) || undefined,
      actor: actor ? actor._id : null,
      actorName: actor ? actor.name : 'system',
      actorRole: actor ? actor.role : 'system',
      action,
      entityType,
      entityId: entityId ? String(entityId) : '',
      meta,
      ip
    });
  } catch (err) {
    logger.error('Audit write failed', { action, error: err.message });
  }
}

/** Convenience wrapper to audit from an Express request. */
const fromRequest = (req, entry) => record({ actor: req.user, collegeId: req.college && req.college._id, ip: req.ip, ...entry });

module.exports = { record, fromRequest };
