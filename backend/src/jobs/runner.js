const os = require('os');
const crypto = require('crypto');
const { JobLock, JobRun } = require('../models');
const logger = require('../utils/logger');
const { isDuplicateKey } = require('../utils/mongoErrors');

const OWNER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
const registry = new Map();

/** Registers a job: `run()` must be idempotent (safe to execute twice, or on two servers). */
function defineJob({ name, intervalMin, lockMinutes = 10, run }) {
  registry.set(name, { name, intervalMin, lockMinutes, run });
}

/** Takes the cross-instance lock for a job, or returns false if another instance holds it. */
async function acquire(name, lockMinutes) {
  const now = new Date();
  try {
    const doc = await JobLock.findOneAndUpdate(
      { _id: name, $or: [{ lockedUntil: { $lt: now } }, { owner: OWNER }] },
      { $set: { owner: OWNER, lockedUntil: new Date(now.getTime() + lockMinutes * 60000) } },
      { upsert: true, returnDocument: 'after' }
    );
    return Boolean(doc);
  } catch (err) {
    if (isDuplicateKey(err)) return false; // the lock exists and is held by someone else
    throw err;
  }
}

const release = name => JobLock.updateOne({ _id: name, owner: OWNER }, { $set: { lockedUntil: new Date(0) } });

/**
 * Executes one job under the distributed lock and records the outcome. Failures are logged and
 * stored (never swallowed silently) and do not stop the other jobs.
 */
async function runJob(name, { force = false } = {}) {
  const job = registry.get(name);
  if (!job) throw new Error(`Unknown job ${name}`);
  if (!(await acquire(name, job.lockMinutes))) {
    logger.info('job skipped: lock held elsewhere', { job: name });
    return { status: 'skipped' };
  }
  const run = await JobRun.create({ name, status: 'running', owner: OWNER });
  const started = Date.now();
  try {
    const stats = (await job.run({ force })) || {};
    await JobRun.updateOne({ _id: run._id }, { $set: { status: 'ok', finishedAt: new Date(), durationMs: Date.now() - started, stats } });
    return { status: 'ok', stats };
  } catch (err) {
    logger.error('job failed', { job: name, error: err.message, stack: err.stack });
    await JobRun.updateOne({ _id: run._id }, { $set: { status: 'failed', finishedAt: new Date(), durationMs: Date.now() - started, error: err.message.slice(0, 500) } });
    return { status: 'failed', error: err.message };
  } finally {
    await release(name);
  }
}

/** Starts interval timers for every defined job (timers never keep the process alive). */
function startScheduler() {
  const timers = [];
  for (const job of registry.values()) {
    if (!job.intervalMin || job.intervalMin <= 0) continue;
    const t = setInterval(() => { runJob(job.name).catch(e => logger.error('job scheduler error', { job: job.name, error: e.message })); }, job.intervalMin * 60000);
    t.unref();
    timers.push(t);
  }
  return () => timers.forEach(clearInterval);
}

/** Latest run of every job, for the readiness/status endpoints. */
async function status() {
  const rows = await Promise.all([...registry.keys()].map(async name => {
    const last = await JobRun.findOne({ name }).sort({ startedAt: -1 }).lean();
    const lastOk = await JobRun.findOne({ name, status: 'ok' }).sort({ startedAt: -1 }).select('startedAt').lean();
    return { name, intervalMin: registry.get(name).intervalMin, last: last && { status: last.status, startedAt: last.startedAt, durationMs: last.durationMs, error: last.error }, lastOkAt: lastOk && lastOk.startedAt };
  }));
  return rows;
}

const names = () => [...registry.keys()];

module.exports = { defineJob, runJob, startScheduler, status, names, OWNER };
