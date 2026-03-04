const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

function downstreamResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
  };
}

function rbacResponse(allowed) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ allowed, userId: 'user-1', reason: allowed ? null : 'Permission denied' }),
  };
}

test('runtime gateway enforcement for org/membership routes', async () => {
  const calls = [];
  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      calls.push({ target, options });

      if (target.includes('/rbac/check')) {
        const auth = options.headers?.authorization || '';
        const allowed = auth.includes('allow');
        return rbacResponse(allowed);
      }

      if (target.includes('/orgs') || target.includes('/members')) {
        if (target.endsWith('/orgs')) return downstreamResponse(201, { message: 'org created' });
        if (target.includes('/transfer')) return downstreamResponse(200, { message: 'transfer ok' });
        if (target.includes('/members')) return downstreamResponse(201, { message: 'member added' });
        return downstreamResponse(200, { message: 'org read' });
      }

      if (target.includes('/internal/audit/events')) {
        return downstreamResponse(202, { accepted: true });
      }

      return downstreamResponse(200, {});
    },
  });

  const noToken = await app.inject({ method: 'GET', url: '/orgs/org-1' });
  assert.equal(noToken.statusCode, 401);

  const denied = await app.inject({
    method: 'GET',
    url: '/orgs/org-1',
    headers: { authorization: 'Bearer deny-token' },
  });
  assert.equal(denied.statusCode, 403);

  const orgCreate = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: 'Bearer allow-token' },
    payload: { name: 'North Hospital', type: 'hospital', ownerNin: '90000000001' },
  });
  assert.equal(orgCreate.statusCode, 201);

  const addMember = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/members',
    headers: { authorization: 'Bearer allow-token' },
    payload: { nin: '90000000001' },
  });
  assert.equal(addMember.statusCode, 201);

  const transfer = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/members/member-1/transfer',
    headers: { authorization: 'Bearer allow-token' },
    payload: { fromBranchId: 'a', toBranchId: 'b' },
  });
  assert.equal(transfer.statusCode, 200);

  const forwardedAuthCalls = calls.filter((c) => c.target.includes('/orgs') || c.target.includes('/members'));
  assert.equal(forwardedAuthCalls.every((c) => c.options.headers?.authorization === 'Bearer allow-token'), true);
});
