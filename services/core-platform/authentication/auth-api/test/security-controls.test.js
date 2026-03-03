const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isIpRateLimited,
  isIdentifierLocked,
  computeLockUntil,
  isLockActive,
  nextOtpCooldownMs,
  sanitizeAuditMetadata,
} = require('../src/security-controls');

test('IP rate limit allows <= 10 attempts', () => {
  assert.equal(isIpRateLimited(10), false);
});

test('IP rate limit blocks > 10 attempts', () => {
  assert.equal(isIpRateLimited(11), true);
});

test('identifier lockout activates at threshold', () => {
  assert.equal(isIdentifierLocked(5), true);
});

test('identifier lockout not active below threshold', () => {
  assert.equal(isIdentifierLocked(4), false);
});

test('lock expiry returns inactive after duration', () => {
  const now = Date.now();
  const lockUntil = computeLockUntil(now, 1);
  assert.equal(isLockActive(lockUntil, now), true);
  assert.equal(isLockActive(lockUntil, now + 2000), false);
});

test('otp cooldown increases with attempts and resets after invalidation threshold', () => {
  assert.equal(nextOtpCooldownMs(1) < nextOtpCooldownMs(2), true);
  assert.equal(nextOtpCooldownMs(4) > nextOtpCooldownMs(3), true);
  assert.equal(nextOtpCooldownMs(5), 0);
});

test('audit metadata sanitization removes secret fields', () => {
  const sanitized = sanitizeAuditMetadata({
    channel: 'email',
    password: 'secret',
    nested: {
      code: '123456',
      otp: '654321',
      keep: 'ok',
    },
    refreshToken: 'x',
  });

  assert.equal(sanitized.password, undefined);
  assert.equal(sanitized.nested.code, undefined);
  assert.equal(sanitized.nested.otp, undefined);
  assert.equal(sanitized.refreshToken, undefined);
  assert.equal(sanitized.nested.keep, 'ok');
});
