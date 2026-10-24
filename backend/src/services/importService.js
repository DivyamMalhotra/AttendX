const crypto = require('crypto');
const ImportBatch = require('../models/ImportBatch');
const kinds = require('./importKinds');
const { parseCsv, normalizeHeader } = require('../utils/csvParse');
const { AppError, badRequest, conflict, forbidden, notFound } = require('../utils/errors');
const audit = require('./auditService');
const logger = require('../utils/logger');

/**
 * Bulk import in two steps. PREVIEW parses and validates the whole file and stores the result without touching any
 * real data; CONFIRM applies it. Confirming is an atomic claim (a double click or a second admin cannot apply a
 * batch twice), every row keeps its own outcome, and a batch interrupted mid-way is resumed from where it stopped.
 */
const MAX_ROWS = 2000;
const PREVIEW_TTL_MS = 24 * 3600 * 1000;
const LEASE_MS = 10 * 60 * 1000;

const kindOf = key => {
  const k = kinds[key];
  if (!k) throw badRequest('Unknown import type.', undefined, 'UNKNOWN_IMPORT');
  return k;
};

function assertMayImport(perms, kind) {
  if (!perms.can('imports.manage') || !perms.can(kind.permission)) throw forbidden(`Importing ${kind.label.toLowerCase()} needs the "imports.manage" and "${kind.permission}" permissions.`);
}

const template = key => kindOf(key).template;

async function preview({ actor, perms, college, kind: kindKey, params = {}, buffer, fileName }) {
  const kind = kindOf(kindKey);
  assertMayImport(perms, kind);
  let table;
  try { table = parseCsv(buffer.toString('utf8')); } catch (err) { throw badRequest(err.message, undefined, 'INVALID_CSV'); }
  if (table.length < 2) throw badRequest('The file has no data rows.', undefined, 'EMPTY_FILE');
  if (table.length - 1 > MAX_ROWS) throw badRequest(`A file can hold at most ${MAX_ROWS} rows. Split it and import in parts.`, undefined, 'TOO_MANY_ROWS');

  const header = table[0].map(normalizeHeader);
  const missing = kind.required.filter(c => !header.includes(c));
  if (missing.length) throw badRequest(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`, undefined, 'MISSING_COLUMNS');
  const ignored = header.filter(h => h && !kind.columns.includes(h));

  const ctx = await kind.prepare({ actor, perms, college, params, req: { perms, college } });
  const seen = new Map();
  const rows = table.slice(1).map((cells, i) => {
    const line = i + 2;
    const raw = {};
    header.forEach((h, c) => { if (kind.columns.includes(h)) raw[h] = cells[c]; });
    const { data, errors } = kind.validate(raw, ctx);
    for (const key of errors.length ? [] : kind.keys(data)) {
      if (seen.has(key)) errors.push(`Duplicate of line ${seen.get(key)} in this file.`);
      else seen.set(key, line);
    }
    return { line, data, problems: errors, state: 'pending', message: '' };
  });
  const invalid = rows.filter(r => r.problems.length).length;

  const batch = await ImportBatch.create({
    college: college._id, kind: kindKey, params, fileName: String(fileName || '').slice(0, 120), checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    rows, totals: { rows: rows.length, valid: rows.length - invalid, invalid }, createdBy: actor._id, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS)
  });
  await audit.record({ actor, collegeId: college._id, action: 'import.previewed', entityType: 'ImportBatch', entityId: batch._id, meta: { kind: kindKey, rows: rows.length, invalid } });
  return { ...view(batch), ignoredColumns: ignored };
}

const view = (batch, { full = false } = {}) => ({
  id: String(batch._id), kind: batch.kind, fileName: batch.fileName, status: batch.status, totals: batch.totals, extras: batch.extras || {},
  expiresAt: batch.expiresAt, confirmedAt: batch.confirmedAt, createdAt: batch.createdAt,
  errors: batch.rows.filter(r => r.problems.length).slice(0, 100).map(r => ({ line: r.line, errors: r.problems })),
  failures: batch.rows.filter(r => r.state === 'failed' || r.state === 'skipped').slice(0, 100).map(r => ({ line: r.line, state: r.state, message: r.message })),
  sample: batch.rows.filter(r => !r.problems.length).slice(0, full ? 200 : 10).map(r => ({ line: r.line, ...r.data, state: r.state }))
});

async function load(college, id) {
  const batch = await ImportBatch.findOne({ _id: id, college: college._id });
  if (!batch) throw notFound('Import not found.');
  return batch;
}

const get = async ({ college, id }) => view(await load(college, id), { full: true });
const list = async ({ college }) => (await ImportBatch.find({ college: college._id }).select('-rows').sort({ createdAt: -1 }).limit(30).lean())
  .map(b => ({ id: String(b._id), kind: b.kind, fileName: b.fileName, status: b.status, totals: b.totals, createdAt: b.createdAt, confirmedAt: b.confirmedAt }));

async function cancel({ actor, perms, college, id }) {
  const batch = await load(college, id);
  assertMayImport(perms, kindOf(batch.kind));
  const done = await ImportBatch.findOneAndUpdate({ _id: id, college: college._id, status: 'previewed' }, { $set: { status: 'cancelled' } }, { returnDocument: 'after' });
  if (!done) throw conflict('INVALID_STATE', `This import is ${batch.status} and cannot be cancelled.`);
  await audit.record({ actor, collegeId: college._id, action: 'import.cancelled', entityType: 'ImportBatch', entityId: id });
  return view(done);
}

const tally = rows => rows.reduce((t, r) => { if (r.state !== 'pending') t[r.state] += 1; return t; }, { ok: 0, skipped: 0, failed: 0 });

async function confirm({ actor, perms, college, id, skipInvalid = false }) {
  const peek = await load(college, id);
  const kind = kindOf(peek.kind);
  assertMayImport(perms, kind);
  if (peek.totals.invalid > 0 && !skipInvalid) throw conflict('HAS_ERRORS', `${peek.totals.invalid} row(s) have errors. Fix the file, or confirm with "skip invalid rows".`);

  const now = new Date();
  const batch = await ImportBatch.findOneAndUpdate(
    { _id: id, college: college._id, $or: [{ status: 'previewed', expiresAt: { $gt: now } }, { status: 'importing', leaseUntil: { $lt: now } }] },
    { $set: { status: 'importing', confirmedBy: actor._id, confirmedAt: now, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
    { returnDocument: 'after' }
  );
  if (!batch) {
    if (peek.status === 'previewed') throw conflict('PREVIEW_EXPIRED', 'This preview has expired. Upload the file again.');
    throw conflict('INVALID_STATE', `This import is ${peek.status}.`);
  }

  const extras = { ...(batch.extras || {}) };
  const ctxBatch = { extras };
  try {
    if (kind.batch) {
      const todo = batch.rows.filter(r => r.state === 'pending' && !r.problems.length);
      if (todo.length) {
        const res = await kind.applyBatch({ actor, perms, college, rows: todo, params: batch.params });
        batch.rows.forEach(r => { if (todo.includes(r)) { r.state = res.state; r.message = res.message || ''; } });
      }
    } else {
      const ctx = await kind.prepare({ actor, perms, college, params: batch.params, req: { perms, college } });
      let n = 0;
      for (const row of batch.rows) {
        if (row.state !== 'pending' || row.problems.length) continue;
        try {
          const res = await kind.apply({ actor, perms, college, data: row.data, batch: ctxBatch, ctx });
          row.state = res.state; row.message = res.message || '';
        } catch (err) {
          row.state = 'failed';
          row.message = err instanceof AppError ? err.message : 'Could not be imported.';
          if (!(err instanceof AppError)) logger.error('import row failed', { line: row.line, error: err.message });
        }
        n += 1;
        if (n % 25 === 0) await ImportBatch.updateOne({ _id: batch._id }, { $set: { rows: batch.rows, extras, leaseUntil: new Date(Date.now() + LEASE_MS) } });
      }
    }
  } catch (err) {
    await ImportBatch.updateOne({ _id: batch._id }, { $set: { status: 'failed', rows: batch.rows, extras } });
    await audit.record({ actor, collegeId: college._id, action: 'import.failed', entityType: 'ImportBatch', entityId: id, meta: { reason: err.message } });
    throw err;
  }

  const t = tally(batch.rows);
  const done = await ImportBatch.findOneAndUpdate({ _id: batch._id }, {
    $set: { status: 'completed', rows: batch.rows, extras, leaseUntil: null, 'totals.ok': t.ok, 'totals.skipped': t.skipped, 'totals.failed': t.failed }
  }, { returnDocument: 'after' });
  await audit.record({ actor, collegeId: college._id, action: 'import.completed', entityType: 'ImportBatch', entityId: id, meta: { kind: batch.kind, ...t } });
  return view(done, { full: true });
}

module.exports = { preview, confirm, get, list, cancel, template, MAX_ROWS };
