class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: 'Route not found', requestId: req.id },
  });
}

function errorHandler(error, req, res, _next) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const isServerError = status >= 500;
  const code = error.code || (status === 413 ? 'payload_too_large' : 'internal_error');
  const message = isServerError ? 'Internal server error' : error.message;

  req.log[isServerError ? 'error' : 'warn']({ err: error, status }, 'request failed');
  res.status(status).json({ error: { code, message, requestId: req.id } });
}

module.exports = { AppError, errorHandler, notFoundHandler };
