const analytics = require('../services/analyticsService');
const { allowedSectionIds } = require('../services/permissionService');
const { forbidden } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

/** Section scope for the viewer: null = whole college, otherwise only the sections of their departments. */
const scopeFor = (req, perm) => allowedSectionIds(req, perm);

exports.overview = asyncHandler(async (req, res) => {
  const sectionIds = await scopeFor(req, 'analytics.view');
  let ids = sectionIds;
  if (req.validatedQuery.sectionId) {
    const wanted = req.validatedQuery.sectionId;
    if (sectionIds && !sectionIds.some(s => String(s) === wanted)) throw forbidden('That section is outside your departments.');
    ids = [wanted];
  }
  res.json({ data: await analytics.overview({ college: req.college, sectionIds: ids, sessionId: req.validatedQuery.sessionId }) });
});

/** Department-scoped at-risk list (HOD). Teachers see their mentees through /api/mentor/attendance-watch instead. */
exports.atRisk = asyncHandler(async (req, res) => {
  const sectionIds = await scopeFor(req, 'analytics.atRisk');
  const data = await analytics.atRisk({ college: req.college, sectionIds, limit: req.validatedQuery.limit });
  res.json({ data: data.rows, meta: { total: data.total, criteria: data.criteria } });
});
