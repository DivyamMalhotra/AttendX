class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details, code = 'BAD_REQUEST') => new AppError(400, code, message, details);
const unauthorized = (message = 'Authentication required.', code = 'UNAUTHENTICATED') => new AppError(401, code, message);
const forbidden = (message = 'You do not have permission to do that.', code = 'FORBIDDEN') => new AppError(403, code, message);
const notFound = (message = 'Not found.', code = 'NOT_FOUND') => new AppError(404, code, message);
const conflict = (code, message, details) => new AppError(409, code, message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
