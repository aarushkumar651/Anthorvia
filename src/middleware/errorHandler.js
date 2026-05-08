const logger = require('../config/logger');
const { error } = require('../utils/response');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    userId: req.user?.id,
  });

  if (err.name === 'ValidationError') {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: err.details || err.message,
    });
  }

  if (err.code === '23505') {
    return error(res, 'Resource already exists', 409);
  }

  if (err.code === '23503') {
    return error(res, 'Referenced resource not found', 404);
  }

  if (err.message && err.message.includes('CORS')) {
    return error(res, 'CORS policy violation', 403);
  }

  const statusCode = err.statusCode || err.status || 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Internal server error'
      : err.message || 'Internal server error';

  return error(res, message, statusCode);
}

function notFoundHandler(req, res) {
  return error(res, `Route ${req.method} ${req.path} not found`, 404);
}

module.exports = { errorHandler, notFoundHandler };
