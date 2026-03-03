const crypto = require('crypto');

const REDACTED = '[REDACTED]';

const blockedAuditKeys = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'code',
  'otp',
  'rawotp',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
  'authorization',
  'token',
  'idtoken',
  'id_token',
  'bearer',
]);

const eventTypes = new Set([
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILURE',
  'AUTH_PASSWORD_SET',
  'AUTH_PASSWORD_CHANGE',
  'AUTH_PASSWORD_RESET_REQUEST',
  'AUTH_PASSWORD_RESET_COMPLETE',
  'AUTH_LOGOUT',
  'AUTH_PHONE_ADDED',
  'AUTH_PHONE_VERIFIED',
  'AUTH_EMAIL_ADDED',
  'AUTH_EMAIL_VERIFIED',
  'RBAC_ROLE_CREATED',
  'RBAC_ROLE_UPDATED',
  'RBAC_ROLE_DELETED',
  'RBAC_PERMISSION_CREATED',
  'RBAC_PERMISSION_ASSIGNED',
  'RBAC_USER_OVERRIDE_APPLIED',
  'RBAC_ACCESS_GRANTED',
  'RBAC_ACCESS_DENIED',
  'NIN_LOOKUP_SUCCESS',
  'NIN_LOOKUP_FAILURE',
  'NIN_REFRESH_REQUESTED',
]);

function isBlockedAuditKey(key) {
  return blockedAuditKeys.has(String(key).toLowerCase());
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item));
  }

  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (isBlockedAuditKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = sanitizeMetadata(rawValue);
  }
  return out;
}

function normalizeEvent(input) {
  const eventType = typeof input?.eventType === 'string' ? input.eventType : '';
  const createdAt = input?.createdAt ? new Date(input.createdAt) : new Date();
  const normalized = {
    eventId: typeof input?.eventId === 'string' && input.eventId ? input.eventId : crypto.randomUUID(),
    userId: input?.userId ? String(input.userId) : null,
    organizationId: input?.organizationId ? String(input.organizationId) : null,
    eventType,
    action: typeof input?.action === 'string' ? input.action : eventType,
    resource:
      input?.resource && typeof input.resource === 'object'
        ? {
            type: input.resource.type ? String(input.resource.type) : null,
            id: input.resource.id ? String(input.resource.id) : null,
          }
        : null,
    permissionKey: input?.permissionKey ? String(input.permissionKey) : null,
    ipAddress: input?.ipAddress ? String(input.ipAddress) : null,
    userAgent: input?.userAgent ? String(input.userAgent) : null,
    metadata: sanitizeMetadata(input?.metadata || {}),
    outcome: input?.outcome === 'failure' ? 'failure' : 'success',
    failureReason: input?.failureReason ? String(input.failureReason) : null,
    createdAt,
  };

  if (!eventTypes.has(normalized.eventType)) {
    normalized.eventType = 'AUTH_LOGIN_FAILURE';
    normalized.failureReason = normalized.failureReason || 'UNKNOWN_EVENT_TYPE';
    normalized.outcome = 'failure';
  }

  return normalized;
}

module.exports = {
  REDACTED,
  blockedAuditKeys,
  isBlockedAuditKey,
  sanitizeMetadata,
  normalizeEvent,
};
