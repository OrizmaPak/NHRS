function getRequiredPermissionKeys(rule) {
  if (!rule || typeof rule !== 'object') {
    return [];
  }

  const keys = [];
  const primaryPermissionKey = typeof rule.permissionKey === 'string' ? rule.permissionKey.trim() : '';
  if (primaryPermissionKey) {
    keys.push(primaryPermissionKey);
  }

  if (Array.isArray(rule.permissionAnyOf)) {
    for (const candidate of rule.permissionAnyOf) {
      const normalized = String(candidate || '').trim();
      if (normalized) {
        keys.push(normalized);
      }
    }
  }

  return Array.from(new Set(keys));
}

function evaluateAuthzResponse({ rule, hasBearerToken, checkStatus, checkBody }) {
  const requiredPermissionKeys = getRequiredPermissionKeys(rule);
  const primaryPermissionKey = requiredPermissionKeys[0] || null;

  if (!rule || rule.public || requiredPermissionKeys.length === 0) {
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
    const body = { message: 'Access denied', permissionKey: primaryPermissionKey };
    if (requiredPermissionKeys.length > 1) {
      body.requiredPermissions = requiredPermissionKeys;
    }
    return {
      proceed: false,
      statusCode: 403,
      body,
    };
  }

  if (!checkBody?.allowed) {
    const body = {
      message: 'Access denied',
      permissionKey: primaryPermissionKey,
      reason: checkBody?.reason,
      matchedRules: checkBody?.matchedRules,
    };
    if (requiredPermissionKeys.length > 1) {
      body.requiredPermissions = requiredPermissionKeys;
    }
    return {
      proceed: false,
      statusCode: 403,
      body,
    };
  }

  return { proceed: true };
}

module.exports = {
  evaluateAuthzResponse,
  getRequiredPermissionKeys,
};
