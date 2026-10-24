const fs = require('fs');
const imports = require('../services/importService');
const exportsSvc = require('../services/exportService');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest } = require('../utils/errors');

const ctx = req => ({ actor: req.user, perms: req.perms, college: req.college });

/** Upload -> parse -> preview. The uploaded file is read once and deleted straight away; only validated rows are kept. */
exports.preview = asyncHandler(async (req, res) => {
  const file = req.files && req.files[0];
  if (!file) throw badRequest('Attach a CSV file.', undefined, 'FILE_REQUIRED');
  let buffer;
  try { buffer = fs.readFileSync(file.path); } finally { fs.unlink(file.path, () => {}); }
  res.status(201).json({ data: await imports.preview({ ...ctx(req), kind: req.params.kind, params: req.body, buffer, fileName: file.originalname }) });
});
exports.confirm = asyncHandler(async (req, res) => res.json({ data: await imports.confirm({ ...ctx(req), id: req.params.id, skipInvalid: req.body.skipInvalid }) }));
exports.cancel = asyncHandler(async (req, res) => res.json({ data: await imports.cancel({ ...ctx(req), id: req.params.id }) }));
exports.get = asyncHandler(async (req, res) => res.json({ data: await imports.get({ college: req.college, id: req.params.id }) }));
exports.list = asyncHandler(async (req, res) => res.json({ data: await imports.list({ college: req.college }) }));
exports.template = (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.kind}-template.csv"`);
  res.send(imports.template(req.params.kind));
};

exports.export = asyncHandler(async (req, res) => {
  const out = await exportsSvc.exportCsv({ ...ctx(req), kind: req.params.kind });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.send(out.csv);
});
