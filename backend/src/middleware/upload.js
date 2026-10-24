const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { config } = require('../config/env');
const { badRequest } = require('../utils/errors');

const OOXML = b => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;   // "PK\x03\x04" (zip container)

/**
 * Accepted document types. The MIME type sent by the browser is only a claim, so every upload is also
 * checked against the file's real leading bytes ("magic numbers"). Executable or script types are not listed.
 */
const ALLOWED = {
  'application/pdf': { ext: '.pdf', magic: b => b.slice(0, 4).toString() === '%PDF' },
  'image/png': { ext: '.png', magic: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: '.jpg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', magic: OOXML },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', magic: OOXML },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', magic: OOXML },
  'text/csv': { ext: '.csv', magic: b => !b.includes(0) },
  'text/plain': { ext: '.txt', magic: b => !b.includes(0) }
};

/** Sets of types for common uses. */
const TYPE_SETS = {
  basic: ['application/pdf', 'image/png', 'image/jpeg'],
  coursework: ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'],
  csv: ['text/csv', 'text/plain', 'application/vnd.ms-excel']
};
ALLOWED['application/vnd.ms-excel'] = { ext: '.csv', magic: b => !b.includes(0) };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute directory for one kind of upload; names are server-generated, never client supplied. */
const uploadDir = kind => ensureDir(path.join(config.uploads.dir, kind));

/** Resolves a stored file name inside the upload directory and refuses anything that escapes it. */
function resolveStored(kind, storedName) {
  const base = uploadDir(kind);
  const full = path.resolve(base, path.basename(String(storedName)));
  if (path.dirname(full) !== path.resolve(base)) throw badRequest('Invalid file reference.');
  return full;
}

const removeFile = file => {
  if (file && file.path) fs.unlink(file.path, () => {});
};

/** Metadata persisted for an uploaded file (the original name is only ever shown, never used as a path). */
const describe = file => ({ storedName: file.filename, originalName: String(file.originalname).slice(0, 120), mimeType: file.mimetype, size: file.size });

function makeUploader(kind, types, { maxFiles, maxBytes }) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir(kind)),
    filename: (req, file, cb) => {
      const meta = ALLOWED[file.mimetype];
      cb(null, `${crypto.randomBytes(16).toString('hex')}${meta ? meta.ext : '.bin'}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: maxFiles },
    fileFilter: (req, file, cb) => {
      if (!types.includes(file.mimetype) || !ALLOWED[file.mimetype]) return cb(badRequest('That file type is not allowed.', undefined, 'UNSUPPORTED_FILE_TYPE'));
      cb(null, true);
    }
  });
}

function verifyContent(files) {
  for (const file of files) {
    const fd = fs.openSync(file.path, 'r');
    const head = Buffer.alloc(512);
    const n = fs.readSync(fd, head, 0, 512, 0);
    fs.closeSync(fd);
    if (!ALLOWED[file.mimetype].magic(head.subarray(0, n))) return false;
  }
  return true;
}

/**
 * Upload middleware for one or more files in one form field. After Multer saves the files the real content
 * is checked against the declared type, and every saved file is deleted again if the content is wrong or the
 * request later fails, so rejected requests leave nothing behind. Files land in req.files (always an array).
 */
function uploadFiles(kind, { field = 'files', maxFiles = 1, types = TYPE_SETS.basic, maxBytes = config.uploads.maxBytes } = {}) {
  const upload = makeUploader(kind, types, { maxFiles, maxBytes }).array(field, maxFiles);
  return [
    (req, res, next) => upload(req, res, err => next(err)),
    (req, res, next) => {
      req.files = req.files || [];
      if (!req.files.length) return next();
      let valid = false;
      try { valid = verifyContent(req.files); } catch (e) { req.files.forEach(removeFile); return next(e); }
      if (!valid) {
        req.files.forEach(removeFile);
        return next(badRequest('A file\'s content does not match its type.', undefined, 'UNSUPPORTED_FILE_TYPE'));
      }
      res.on('finish', () => { if (res.statusCode >= 400) req.files.forEach(removeFile); });
      next();
    }
  ];
}

/** Single optional file in `field`, exposed as req.file (used by the duty leave form). */
function singleDocument(kind, field = 'document') {
  const [parse, verify] = uploadFiles(kind, { field, maxFiles: 1, types: TYPE_SETS.basic });
  return [parse, verify, (req, res, next) => { req.file = req.files[0]; next(); }];
}

/** Streams a stored file to the response as a download (never inline, never sniffed). */
function sendStored(res, kind, meta, downloadName) {
  const full = resolveStored(kind, meta.storedName);
  if (!fs.existsSync(full)) return false;
  res.setHeader('Content-Type', meta.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/[^\w.\- ]+/g, '_')}${path.extname(full)}"`);
  fs.createReadStream(full).pipe(res);
  return true;
}

module.exports = { uploadFiles, singleDocument, resolveStored, removeFile, uploadDir, describe, sendStored, TYPE_SETS, ALLOWED };
