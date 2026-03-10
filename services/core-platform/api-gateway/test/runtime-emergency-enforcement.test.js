const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJwt(sub) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ sub }));
  return `${header}.${payload}.sig`;
}

function downstreamResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
  };
}

function readSubFromAuthorization(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return payload?.sub || null;
}

test('gateway enforces emergency auth and org scope before proxying', async () => {
  const allowToken = makeJwt('user-allow');
  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);

      if (target.includes('/rbac/check')) {
        const userId = readSubFromAuthorization(options.headers?.authorization || '');
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: userId === 'user-allow', userId, reason: null }),
        };
      }

      if (target.includes('/memberships/me?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: true, membership: { membershipId: 'm-1' } }),
        };
      }

      if (target.includes('/internal/orgs/') && target.includes('/access')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: true }),
        };
      }

      if (target.includes('/internal/audit/events')) {
        return downstreamResponse(202, { accepted: true });
      }

      if (target.includes('/emergency/requests/r-1/responses')) {
        return downstreamResponse(201, { message: 'response created' });
      }

      return downstreamResponse(200, {});
    },
  });

  const unauth = await app.inject({ method: 'POST', url: '/emergency/requests/r-1/responses', payload: { responseType: 'available', availability: true } });
  assert.equal(unauth.statusCode, 401);

  const missingOrg = await app.inject({
    method: 'POST',
    url: '/emergency/requests/r-1/responses',
    headers: { authorization: `Bearer ${allowToken}` },
    payload: { responseType: 'available', availability: true },
  });
  assert.equal(missingOrg.statusCode, 400);

  const allowed = await app.inject({
    method: 'POST',
    url: '/emergency/requests/r-1/responses',
    headers: { authorization: `Bearer ${allowToken}`, 'x-org-id': 'org-1', 'x-branch-id': 'b-1' },
    payload: { responseType: 'available', availability: true },
  });
  assert.equal(allowed.statusCode, 201);
});
