const jobs = require('../jobs');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/errors');
const audit = require('../services/auditService');

exports.jobStatus = asyncHandler(async (req, res) => res.json({ data: await jobs.jobStatus() }));

/** Runs a job on demand (same lock and idempotency rules as the scheduler). */
exports.runJob = asyncHandler(async (req, res) => {
  if (!jobs.jobNames().includes(req.params.name)) throw notFound('Unknown job.');
  const result = await jobs.runJob(req.params.name, { force: true });
  await audit.fromRequest(req, { action: 'system.job_run', entityType: 'Job', entityId: req.params.name, meta: { status: result.status } });
  res.json({ data: result });
});
