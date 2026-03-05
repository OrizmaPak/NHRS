function buildTraceContext(req, serviceName) {
  const nhrs = req.nhrs || {};
  return {
    serviceName,
    requestId: nhrs.requestId || req.headers['x-request-id'] || null,
    userId: nhrs.userId || req.auth?.userId || null,
    orgId: nhrs.orgId || req.headers['x-org-id'] || null,
    branchId: nhrs.branchId || req.headers['x-branch-id'] || null,
    route: req.routeOptions?.url || req.url || null,
  };
}

function withTrace(req, serviceName, payload = {}) {
  return { ...buildTraceContext(req, serviceName), ...payload };
}

module.exports = {
  buildTraceContext,
  withTrace,
};

