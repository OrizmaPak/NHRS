function formatError(err) {
  if (!err) {
    return {
      statusCode: 500,
      body: {
        message: 'INTERNAL_SERVER_ERROR',
        code: 'INTERNAL_SERVER_ERROR',
      },
    };
  }

  if (err.validation) {
    return {
      statusCode: 400,
      body: {
        message: 'VALIDATION_ERROR',
        code: 'VALIDATION_ERROR',
        details: err.validation,
      },
    };
  }

  const statusCode = Number(err.statusCode || err.status) || 500;
  const code = String(err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'));
  const message = String(err.message || code);
  const out = {
    message,
    code,
  };
  if (err.details && typeof err.details === 'object') {
    out.details = err.details;
  }
  return { statusCode, body: out };
}

function setStandardErrorHandler(fastify) {
  fastify.setErrorHandler((err, req, reply) => {
    const formatted = formatError(err);
    req.log.error({ err, code: formatted.body.code }, 'request failed');
    reply.code(formatted.statusCode).send(formatted.body);
  });
}

module.exports = {
  formatError,
  setStandardErrorHandler,
};

