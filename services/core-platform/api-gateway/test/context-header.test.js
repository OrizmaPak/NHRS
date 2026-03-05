const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const { verifySignedContext } = require('../../../../libs/shared/src/nhrs-context');

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJwt(payload) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

test('gateway attaches signed x-nhrs-context headers to downstream proxy request', async () => {
  let downstreamHeaders = null;
  const token = makeJwt({ sub: 'user-ctx-1', roles: ['org_admin'] });

  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/memberships/me?')) {
        return { ok: true, status: 200, json: async () => ({ allowed: true, membership: { membershipId: 'm1' } }) };
      }
      if (target.includes('/rbac/check')) {
        return { ok: true, status: 200, json: async () => ({ allowed: true, userId: 'user-ctx-1' }) };
      }
      if (target.includes('/orgs/org-1')) {
        downstreamHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true }),
          headers: { get: () => 'application/json' },
        };
      }
      if (target.includes('/internal/audit/events')) {
        return {
          ok: true,
          status: 202,
          text: async () => JSON.stringify({ accepted: true }),
          headers: { get: () => 'application/json' },
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({}),
        headers: { get: () => 'application/json' },
      };
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/orgs/org-1',
    headers: {
      authorization: `Bearer ${token}`,
      'x-request-id': 'req-test-1',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.ok(downstreamHeaders['x-nhrs-context']);
  assert.ok(downstreamHeaders['x-nhrs-context-signature']);

  const verified = verifySignedContext({
    encodedContext: downstreamHeaders['x-nhrs-context'],
    signature: downstreamHeaders['x-nhrs-context-signature'],
    secret: process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret',
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.context.requestId, 'req-test-1');
  assert.equal(verified.context.userId, 'user-ctx-1');
  assert.equal(verified.context.orgId, 'org-1');
  assert.deepEqual(verified.context.permissionsChecked, ['org.read']);
  assert.equal(verified.context.membershipChecked, true);
});
