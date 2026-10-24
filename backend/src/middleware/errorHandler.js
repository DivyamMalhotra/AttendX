const { ZodError } = require('zod');
const multer = require('multer');
const { AppError } = require('../utils/errors');
const { isDuplicateKey, duplicateFields } = require('../utils/mongoErrors');
const { config } = require('../config/env');
const logger = require('../utils/logger');

// The backend is API-only: every unknown path answers with a JSON 404 (the frontend serves the HTML pages).
const notFoundHandler = (req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found.'));

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Invalid input.', err.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
  }
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return new AppError(tooBig ? 413 : 400, tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
      tooBig ? 'The file is larger than the allowed size.' : 'The file could not be uploaded.');
  }
  if (isDuplicateKey(err)) {
    return new AppError(409, 'DUPLICATE', 'That record already exists.', { fields: duplicateFields(err) });
  }
  if (err && err.name === 'ValidationError' && err.errors) {
    return new AppError(400, 'VALIDATION_ERROR', 'Invalid input.',
      Object.values(err.errors).map(e => ({ field: e.path, message: e.message })));
  }
  if (err && err.name === 'CastError') return new AppError(400, 'BAD_REQUEST', 'Malformed identifier or value.');
  if (err && err.type === 'entity.parse.failed') return new AppError(400, 'BAD_JSON', 'Request body is not valid JSON.');
  if (err && err.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const known = normalize(err);
  if (!known) {
    logger.error('Unhandled error', { path: req.originalUrl.split('?')[0], method: req.method, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side.',
        requestId: req.id,
        ...(config.isProd ? {} : { debug: err && err.message })
      }
    });
  }
  if (known.status >= 500) logger.error(known.message, { path: req.originalUrl });
  res.status(known.status).json({ error: { code: known.code, message: known.message, requestId: req.id, ...(known.details ? { details: known.details } : {}) } });
}

module.exports = { errorHandler, notFoundHandler };
