const analytics = require('../services/analyticsService');
const { allowedSectionIds } = require('../services/permissionService');
const { toCsv } = require('../utils/csv');
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

exports.atRisk = asyncHandler(async (req, res) => {
  const sectionIds = await scopeFor(req, 'analytics.atRisk');
  const data = await analytics.atRisk({ college: req.college, sectionIds, limit: req.validatedQuery.format === 'csv' ? 5000 : req.validatedQuery.limit });
  if (req.validatedQuery.format === 'csv') {
    if (!req.perms.can('reports.export')) throw forbidden('You may view this list but not export it.');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="at-risk-students.csv"');
    return res.send(toCsv([
      { label: 'Roll no', value: 'rollNo' }, { label: 'Name', value: 'name' }, { label: 'Section', value: 'section' },
      { label: 'Attendance %', value: r => (r.attendance ?? '') }, { label: 'Flags', value: r => r.flags.map(f => f.detail).join('; ') }
    ], data.rows));
  }
  res.json({ data: data.rows, meta: { total: data.total, criteria: data.criteria } });
});
