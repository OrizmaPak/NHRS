function isIpRateLimited(attemptCount, maxAttempts = 10) {
  return Number(attemptCount) > Number(maxAttempts);
}

function isIdentifierLocked(failureCount, threshold = 5) {
  return Number(failureCount) >= Number(threshold);
}

function computeLockUntil(nowMs, lockSec = 15 * 60) {
  return new Date(Number(nowMs) + Number(lockSec) * 1000);
}

function isLockActive(lockUntil, nowMs = Date.now()) {
  if (!lockUntil) {
    return false;
  }
  return new Date(lockUntil).getTime() > Number(nowMs);
}

function nextOtpCooldownMs(attempts) {
  const count = Number(attempts);
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  if (count >= 5) {
    return 0;
  }
  return Math.min(5 * 60 * 1000, 2000 * Math.pow(2, count - 1));
}

function sanitizeAuditMetadata(value) {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item));
  }

  const blocked = new Set(['password', 'newPassword', 'currentPassword', 'code', 'otp', 'rawOtp', 'refreshToken']);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (blocked.has(key)) {
      continue;
    }
    out[key] = sanitizeAuditMetadata(val);
  }
  return out;
}

module.exports = {
  isIpRateLimited,
  isIdentifierLocked,
  computeLockUntil,
  isLockActive,
  nextOtpCooldownMs,
  sanitizeAuditMetadata,
};
