const test = require('node:test');
const assert = require('node:assert/strict');
const { REDACTED, sanitizeAuditMetadata, buildAuditPayload } = require('../src/audit-utils');

test('sanitizeAuditMetadata redacts token-like fields recursively', () => {
  const result = sanitizeAuditMetadata({
    refreshToken: 'r1',
    Authorization: 'Bearer aaa',
    nested: {
      accessToken: 'a1',
      session: { refresh_token: 'r2' },
    },
    tokens: [{ id_token: 'id1' }, { bearer: 'bbb' }],
  });

  assert.equal(result.refreshToken, REDACTED);
  assert.equal(result.Authorization, REDACTED);
  assert.equal(result.nested.accessToken, REDACTED);
  assert.equal(result.nested.session.refresh_token, REDACTED);
  assert.equal(result.tokens[0].id_token, REDACTED);
  assert.equal(result.tokens[1].bearer, REDACTED);
});

test('buildAuditPayload redacts metadata before request body serialization', () => {
  const payload = buildAuditPayload({
    eventType: 'RBAC_ACCESS_DENIED',
    metadata: {
      refreshToken: 'secret-refresh',
      session: { refreshToken: 'nested-secret' },
      tokens: [{ accessToken: 'token-secret' }],
    },
  });

  assert.equal(payload.metadata.refreshToken, REDACTED);
  assert.equal(payload.metadata.session.refreshToken, REDACTED);
  assert.equal(payload.metadata.tokens[0].accessToken, REDACTED);
});
