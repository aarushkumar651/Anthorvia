function success(res, data = null, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
}

function created(res, data = null, message = 'Created') {
  return success(res, data, message, 201);
}

function error(res, message = 'Internal server error', statusCode = 500, details = null) {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };
  if (details && process.env.NODE_ENV !== 'production') {
    response.details = details;
  }
  return res.status(statusCode).json(response);
}

function validationError(res, errors) {
  return res.status(422).json({
    success: false,
    message: 'Validation failed',
    errors,
    timestamp: new Date().toISOString(),
  });
}

function unauthorized(res, message = 'Unauthorized') {
  return error(res, message, 401);
}

function forbidden(res, message = 'Forbidden', upgradeRequired = false) {
  return res.status(403).json({
    success: false,
    message,
    upgrade_required: upgradeRequired,
    timestamp: new Date().toISOString(),
  });
}

function notFound(res, resource = 'Resource') {
  return error(res, `${resource} not found`, 404);
}

function paginated(res, items, total, page, limit, message = 'Success') {
  return res.status(200).json({
    success: true,
    message,
    data: {
      items,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        has_next: page * limit < total,
        has_prev: page > 1,
      },
    },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { success, created, error, validationError, unauthorized, forbidden, notFound, paginated };
