const mongoose = require('mongoose');

/** One row per background job execution (observability + safe retries). */
const jobRun = new mongoose.Schema({
  name: { type: String, required: true },
  status: { type: String, enum: ['running', 'ok', 'failed', 'skipped'], required: true },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null },
  durationMs: { type: Number, default: 0 },
  owner: { type: String, default: '' },
  stats: { type: mongoose.Schema.Types.Mixed, default: {} },
  error: { type: String, default: '' }
});
jobRun.index({ name: 1, startedAt: -1 });
jobRun.index({ startedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

/** Cross-instance lock so a job never runs twice at once, whichever server picks it up. */
const jobLock = new mongoose.Schema({
  _id: { type: String },
  owner: { type: String, required: true },
  lockedUntil: { type: Date, required: true }
});

/**
 * Persisted live events (Server-Sent Events). Only ids and generic types are stored — never
 * message text or personal data — so a stale or leaked event reveals nothing sensitive.
 */
const liveEvent = new mongoose.Schema({
  seq: { type: Number, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 }
});
liveEvent.index({ user: 1, seq: 1 });

module.exports = {
  JobRun: mongoose.model('JobRun', jobRun),
  JobLock: mongoose.model('JobLock', jobLock),
  LiveEvent: mongoose.model('LiveEvent', liveEvent)
};
