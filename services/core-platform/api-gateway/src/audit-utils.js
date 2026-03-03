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

function isBlockedAuditKey(key) {
  return blockedAuditKeys.has(String(key).toLowerCase());
}

function sanitizeAuditMetadata(value) {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item));
  }

  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (isBlockedAuditKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = sanitizeAuditMetadata(rawValue);
  }
  return out;
}

function buildAuditPayload(event) {
  return {
    ...event,
    metadata: sanitizeAuditMetadata(event?.metadata || {}),
  };
}

module.exports = {
  REDACTED,
  blockedAuditKeys,
  isBlockedAuditKey,
  sanitizeAuditMetadata,
  buildAuditPayload,
};
