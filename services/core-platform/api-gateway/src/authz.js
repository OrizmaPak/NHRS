function evaluateAuthzResponse({ rule, hasBearerToken, checkStatus, checkBody }) {
  if (!rule || rule.public || !rule.permissionKey) {
    return { proceed: true };
  }

  if (!hasBearerToken) {
    return { proceed: false, statusCode: 401, body: { message: 'Unauthorized' } };
  }

  if (checkStatus === 401) {
    return { proceed: false, statusCode: 401, body: { message: 'Unauthorized' } };
  }

  if (checkStatus === 503) {
    return { proceed: false, statusCode: 503, body: { message: 'Authorization service unavailable' } };
  }

  if (checkStatus >= 400) {
    return {
      proceed: false,
      statusCode: 403,
      body: { message: 'Access denied', permissionKey: rule.permissionKey },
    };
  }

  if (!checkBody?.allowed) {
    return {
      proceed: false,
      statusCode: 403,
      body: {
        message: 'Access denied',
        permissionKey: rule.permissionKey,
        reason: checkBody?.reason,
        matchedRules: checkBody?.matchedRules,
      },
    };
  }

  return { proceed: true };
}

module.exports = {
  evaluateAuthzResponse,
};
