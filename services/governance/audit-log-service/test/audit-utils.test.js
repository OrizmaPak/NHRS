const test = require('node:test');
const assert = require('node:assert/strict');
const { REDACTED, sanitizeMetadata, normalizeEvent } = require('../src/audit-utils');

test('sanitizeMetadata redacts token-like fields at top level', () => {
  const input = {
    refreshToken: 'r1',
    refresh_token: 'r2',
    accessToken: 'a1',
    access_token: 'a2',
    authorization: 'Bearer x',
    Authorization: 'Bearer y',
    token: 't',
    idToken: 'id',
    id_token: 'id2',
    bearer: 'b',
  };

  const result = sanitizeMetadata(input);
  assert.equal(result.refreshToken, REDACTED);
  assert.equal(result.refresh_token, REDACTED);
  assert.equal(result.accessToken, REDACTED);
  assert.equal(result.access_token, REDACTED);
  assert.equal(result.authorization, REDACTED);
  assert.equal(result.Authorization, REDACTED);
  assert.equal(result.token, REDACTED);
  assert.equal(result.idToken, REDACTED);
  assert.equal(result.id_token, REDACTED);
  assert.equal(result.bearer, REDACTED);
});

test('sanitizeMetadata redacts nested token-like fields recursively', () => {
  const input = {
    session: {
      refreshToken: 'nested-refresh',
      deeper: {
        accessToken: 'nested-access',
      },
    },
    tokens: [
      { accessToken: 'array-access' },
      { authorization: 'Bearer z' },
    ],
  };

  const result = sanitizeMetadata(input);
  assert.equal(result.session.refreshToken, REDACTED);
  assert.equal(result.session.deeper.accessToken, REDACTED);
  assert.equal(result.tokens[0].accessToken, REDACTED);
  assert.equal(result.tokens[1].authorization, REDACTED);
});

test('normalizeEvent applies metadata redaction before persistence shape', () => {
  const normalized = normalizeEvent({
    eventType: 'AUTH_LOGIN_FAILURE',
    action: 'auth.login',
    metadata: {
      refreshToken: 'leak',
      session: { refreshToken: 'nested-leak' },
      tokens: [{ accessToken: 'array-leak' }],
    },
  });

  assert.equal(normalized.metadata.refreshToken, REDACTED);
  assert.equal(normalized.metadata.session.refreshToken, REDACTED);
  assert.equal(normalized.metadata.tokens[0].accessToken, REDACTED);
});
