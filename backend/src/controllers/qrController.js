const qr = require('../services/qrAttendanceService');
const asyncHandler = require('../utils/asyncHandler');

const ctx = req => ({ actor: req.user, perms: req.perms, college: req.college, classSessionId: req.params.id });

exports.start = asyncHandler(async (req, res) => res.status(201).json({ data: await qr.start({ ...ctx(req), minutes: req.body.minutes }) }));
exports.current = asyncHandler(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ data: await qr.current(ctx(req)) }); });
exports.scans = asyncHandler(async (req, res) => res.json({ data: await qr.scans(ctx(req)) }));
exports.close = asyncHandler(async (req, res) => res.json({ data: await qr.close(ctx(req)) }));
exports.scan = asyncHandler(async (req, res) => {
  const { sessionId, code, lat, lng, accuracy } = req.body;
  res.json({ data: await qr.scan({ college: req.college, profile: req.student, sessionId, code, lat, lng, accuracy, ip: req.ip }) });
});

exports.openForStudent = asyncHandler(async (req, res) => res.json({ data: await qr.openForStudent({ college: req.college, profile: req.student }) }));
