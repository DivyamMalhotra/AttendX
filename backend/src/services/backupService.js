const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable, Transform, pipeline } = require('stream');
const { promisify } = require('util');
const mongoose = require('mongoose');
const { BackupRun } = require('../models');
const { config } = require('../config/env');
const { conflict, notFound, badRequest } = require('../utils/errors');
const logger = require('../utils/logger');

const pipe = promisify(pipeline);
const { EJSON } = mongoose.mongo.BSON;

/**
 * Logical backups. Every collection is streamed as one extended-JSON document per line, gzip-compressed and,
 * when BACKUP_ENCRYPTION_KEY is set, encrypted with AES-256-GCM. A SHA-256 of the finished file is stored in the
 * database and in a sidecar manifest, and a backup is only reported "ok" after it has been read back and the number
 * of documents matches. Restores go into a separate database by default, so a restore can be inspected before
 * anything live is touched.
 *
 * Not included: uploaded files (evidence, assignments, materials). They live in UPLOAD_DIR and must be copied with
 * the server's normal file backups; the manifest records how many there were. Sessions, locks and live events are
 * skipped because they are meaningless after a restore.
 */
const SKIP = new Set(['sessions', 'joblocks', 'liveevents']);
const MAGIC = Buffer.from('AXB1');
const dir = () => { fs.mkdirSync(config.backup.dir, { recursive: true }); return config.backup.dir; };
const keyBytes = () => {
  const k = config.backup.encryptionKey;
  if (!k) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw badRequest('BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes).', undefined, 'BAD_BACKUP_KEY');
  return Buffer.from(k, 'hex');
};

async function* lines(db) {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith('system.') && !SKIP.has(n)).sort();
  yield `${JSON.stringify({ type: 'manifest', version: 1, createdAt: new Date().toISOString(), database: db.databaseName, collections: names })}\n`;
  let documents = 0;
  for (const name of names) {
    for await (const doc of db.collection(name).find({}, { batchSize: 500 })) {
      documents += 1;
      yield `${EJSON.stringify({ c: name, d: doc }, { relaxed: false })}\n`;
    }
  }
  yield `${JSON.stringify({ type: 'end', documents })}\n`;
}

const countUploads = () => {
  try {
    let n = 0;
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { if (e.isDirectory()) walk(path.join(d, e.name)); else n += 1; });
    walk(config.uploads.dir);
    return n;
  } catch (e) { return 0; }
};

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

async function createBackup({ db = mongoose.connection.db } = {}) {
  const recent = await BackupRun.findOne({ status: 'running', startedAt: { $gt: new Date(Date.now() - 30 * 60000) } });
  if (recent) throw conflict('BACKUP_RUNNING', 'A backup is already running.');
  const key = keyBytes();
  const run = await BackupRun.create({ status: 'running', method: 'json', encrypted: Boolean(key) });
  const file = path.join(dir(), `attendx-${stamp()}-${crypto.randomBytes(3).toString('hex')}.ndjson.gz${key ? '.enc' : ''}`);

  try {
    const hash = crypto.createHash('sha256');
    const tap = new Transform({ transform(chunk, enc, cb) { hash.update(chunk); cb(null, chunk); } });
    const out = fs.createWriteStream(file, { mode: 0o600 });
    const stages = [Readable.from(lines(db)), zlib.createGzip()];
    let cipher = null;
    if (key) {
      const iv = crypto.randomBytes(12);
      cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      out.write(Buffer.concat([MAGIC, iv]));
      hash.update(Buffer.concat([MAGIC, iv]));
      stages.push(cipher);
    }
    stages.push(tap, out);
    await pipe(...stages);
    if (cipher) {
      const tag = cipher.getAuthTag();
      fs.appendFileSync(file, tag);
      hash.update(tag);
    }
    const sha256 = hash.digest('hex');
    const verified = await verifyFile(file, { expectSha: sha256 });
    const sizeBytes = fs.statSync(file).size;
    const manifest = { file: path.basename(file), sha256, sizeBytes, encrypted: Boolean(key), collections: verified.collections, documents: verified.documents, uploadFiles: countUploads(), createdAt: new Date().toISOString() };
    fs.writeFileSync(`${file}.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const retention = await applyRetention();
    return BackupRun.findByIdAndUpdate(run._id, { $set: { status: 'ok', finishedAt: new Date(), file: path.basename(file), sizeBytes, sha256, collections: verified.collections, documents: verified.documents, deletedByRetention: retention } }, { returnDocument: 'after' });
  } catch (err) {
    fs.rmSync(file, { force: true });
    logger.error('backup failed', { error: err.message });
    await BackupRun.updateOne({ _id: run._id }, { $set: { status: 'failed', finishedAt: new Date(), error: String(err.message).slice(0, 500) } });
    throw err;
  }
}

/** Opens a backup file as a decompressed (and, if needed, decrypted) byte stream. Errors anywhere in the chain reach the reader. */
function readLines(file) {
  const stat = fs.statSync(file);
  const encrypted = file.endsWith('.enc');
  const stages = [];
  if (encrypted) {
    const key = keyBytes();
    if (!key) throw badRequest('This backup is encrypted: set BACKUP_ENCRYPTION_KEY to read it.', undefined, 'BACKUP_KEY_REQUIRED');
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16); const tag = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0); fs.readSync(fd, tag, 0, 16, stat.size - 16); fs.closeSync(fd);
    if (!head.subarray(0, 4).equals(MAGIC)) throw badRequest('Not an AttendX backup file.', undefined, 'BAD_BACKUP');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(4, 16));
    decipher.setAuthTag(tag);
    stages.push(fs.createReadStream(file, { start: 16, end: stat.size - 17 }), decipher);
  } else {
    stages.push(fs.createReadStream(file));
  }
  stages.push(zlib.createGunzip());
  // pipeline() forwards a failure of any stage (bad auth tag, corrupt gzip) to the last stream, so the reader's
  // for-await rejects instead of the process crashing on an unhandled stream error
  const stream = pipeline(...stages, () => {});
  return { stream, encrypted };
}

async function* eachRecord(file) {
  const { stream } = readLines(file);
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line) yield EJSON.parse(line, { relaxed: false });
    }
  }
  if (buf.trim()) throw new Error('The backup ends in the middle of a record.');
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Reads the whole file back: checksum, decryption/gzip integrity, and the document count in the end marker. */
async function verifyFile(file, { expectSha } = {}) {
  const sha = await sha256File(file);
  if (expectSha && sha !== expectSha) throw new Error('Backup checksum mismatch.');
  let manifest = null; let end = null; let documents = 0;
  const seen = new Set();
  for await (const rec of eachRecord(file)) {
    if (rec.type === 'manifest') manifest = rec;
    else if (rec.type === 'end') end = rec;
    else { documents += 1; seen.add(rec.c); }
  }
  if (!manifest || !end) throw new Error('The backup is incomplete (missing header or end marker).');
  if (Number(end.documents) !== documents) throw new Error(`The backup is damaged: expected ${Number(end.documents)} documents, found ${documents}.`);
  return { ok: true, sha256: sha, documents, collections: seen.size, database: manifest.database, createdAt: manifest.createdAt };
}

/** Deletes backups past retention but always keeps the newest `keepMin` good ones. */
async function applyRetention() {
  const ok = await BackupRun.find({ status: 'ok' }).sort({ startedAt: -1 }).lean();
  const cutoff = Date.now() - config.backup.retentionDays * 86400000;
  const removed = [];
  for (const run of ok.slice(config.backup.keepMin)) {
    if (run.startedAt.getTime() >= cutoff || !run.file) continue;
    for (const f of [run.file, `${run.file}.json`]) fs.rmSync(path.join(config.backup.dir, f), { force: true });
    await BackupRun.updateOne({ _id: run._id }, { $set: { file: '', status: 'ok' } });
    removed.push(run.file);
  }
  return removed;
}

async function verifyRun(id) {
  const run = await BackupRun.findById(id);
  if (!run || !run.file) throw notFound('Backup not found (it may have been removed by retention).');
  const full = path.join(config.backup.dir, path.basename(run.file));
  if (!fs.existsSync(full)) throw notFound('The backup file is missing from the backup folder.');
  return verifyFile(full, { expectSha: run.sha256 });
}

const list = async () => (await BackupRun.find().sort({ startedAt: -1 }).limit(50).lean()).map(r => ({
  id: String(r._id), status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, file: r.file, sizeBytes: r.sizeBytes, encrypted: r.encrypted,
  collections: r.collections, documents: r.documents, sha256: r.sha256, error: r.error, removedByRetention: r.deletedByRetention
}));

/**
 * Restores a backup into `targetDb` (a database NAME on the same server). It refuses the live database and any
 * database that already contains data unless `force` is given, so a restore can never silently overwrite production.
 */
async function restoreInto({ file, targetDb, force = false, client = mongoose.connection.getClient(), liveDb = mongoose.connection.name }) {
  if (!targetDb) throw badRequest('Choose a target database name.', undefined, 'TARGET_REQUIRED');
  if (targetDb === liveDb) throw badRequest('Restoring over the live database is not allowed here. Restore into a new database, check it, then switch the application to it.', undefined, 'LIVE_TARGET');
  await verifyFile(file);
  const db = client.db(targetDb);
  const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
  if (existing.length && !force) throw conflict('TARGET_NOT_EMPTY', `Database "${targetDb}" already has ${existing.length} collection(s). Use an empty database or pass force.`);
  let batch = []; let current = null; let restored = 0;
  const flush = async () => { if (batch.length) { await db.collection(current).insertMany(batch, { ordered: false }); restored += batch.length; batch = []; } };
  for await (const rec of eachRecord(file)) {
    if (rec.type) continue;
    if (rec.c !== current || batch.length >= 500) { await flush(); current = rec.c; }
    batch.push(rec.d);
  }
  await flush();
  return { restored, targetDb };
}

module.exports = { createBackup, verifyFile, verifyRun, applyRetention, restoreInto, list };
