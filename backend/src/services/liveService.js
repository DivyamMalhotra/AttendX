const { EventEmitter } = require('events');
const mongoose = require('mongoose');
const { LiveEvent, Counter } = require('../models');
const logger = require('../utils/logger');

/**
 * Live-update distribution for Server-Sent Events.
 *
 * Every event is persisted (ids and generic types only — never message text or personal data) with a
 * monotonically increasing sequence, so clients can resume with Last-Event-ID after a reconnect.
 * Delivery to connected clients in THIS process uses an in-memory emitter.
 * To fan out across several server instances the service also relays newly inserted events from
 * MongoDB change streams, which requires MongoDB to run as a replica set (Atlas always does). On a
 * standalone MongoDB (development) only same-process delivery plus replay on reconnect is available.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let streamStarted = false;
const seenLocal = new Set();

async function publish(userId, type, data = {}) {
  const seq = await Counter.next('live');
  const evt = await LiveEvent.create({ seq, user: userId, type, data });
  seenLocal.add(seq);
  if (seenLocal.size > 5000) seenLocal.clear();
  emitter.emit(`user:${userId}`, toWire(evt));
  return evt;
}

const toWire = evt => ({ id: evt.seq, type: evt.type, data: evt.data, at: evt.createdAt });

/** Same-process subscription. Returns the unsubscribe function. */
function subscribe(userId, handler) {
  const key = `user:${userId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

/** Events a client missed while disconnected. */
async function replay(userId, afterSeq, limit = 100) {
  const rows = await LiveEvent.find({ user: userId, seq: { $gt: afterSeq } }).sort({ seq: 1 }).limit(limit).lean();
  return rows.map(toWire);
}

/** Relays events written by other server instances (needs a replica set; harmless to call otherwise). */
async function startRelay() {
  if (streamStarted) return false;
  try {
    const admin = mongoose.connection.db.admin();
    const hello = await admin.command({ hello: 1 });
    if (!hello.setName) { logger.info('live events: standalone MongoDB, cross-instance relay disabled'); return false; }
    const stream = LiveEvent.watch([{ $match: { operationType: 'insert' } }]);
    stream.on('change', change => {
      const doc = change.fullDocument;
      if (!doc || seenLocal.has(doc.seq)) return;
      emitter.emit(`user:${doc.user}`, toWire(doc));
    });
    stream.on('error', err => { logger.error('live events change stream error', { error: err.message }); streamStarted = false; });
    streamStarted = true;
    return true;
  } catch (err) {
    logger.warn('live events relay unavailable', { error: err.message });
    return false;
  }
}

module.exports = { publish, subscribe, replay, startRelay };
