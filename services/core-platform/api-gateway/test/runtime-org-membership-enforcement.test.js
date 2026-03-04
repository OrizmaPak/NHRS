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
    json: async () => ({ allowed, userId: allowed ? 'user-1' : 'user-denied', reason: allowed ? null : 'Permission denied' }),
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
        const allowed = auth.includes('allow') || auth.includes('memberless');
        if (auth.includes('memberless')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ allowed: true, userId: 'user-no-membership' }),
          };
        }
        return rbacResponse(allowed);
      }

      if (target.includes('/memberships/me?')) {
        if (target.includes('userId=user-no-membership')) {
          return {
            ok: false,
            status: 403,
            json: async () => ({ message: 'Not a member of this organization' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: true, membership: { membershipId: 'm1' } }),
        };
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

  const notMember = await app.inject({
    method: 'GET',
    url: '/orgs/org-1',
    headers: { authorization: 'Bearer memberless-token' },
  });
  assert.equal(notMember.statusCode, 403);
  assert.equal(notMember.json().message, 'Not a member of this organization');

  const orgCreate = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: 'Bearer allow-token' },
    payload: { name: 'North Hospital', type: 'hospital', ownerNin: '90000000001' },
  });
  assert.equal(orgCreate.statusCode, 201);

  const invite = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: 'Bearer allow-token' },
    payload: { nin: '90000000001', roles: ['doctor'], branchIds: ['b1'] },
  });
  assert.equal(invite.statusCode, 201);

  const transfer = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/members/member-1/transfer',
    headers: { authorization: 'Bearer allow-token' },
    payload: { fromBranchId: 'a', toBranchId: 'b' },
  });
  assert.equal(transfer.statusCode, 200);

  const branchRead = await app.inject({
    method: 'GET',
    url: '/orgs/org-1/branches/branch-9',
    headers: { authorization: 'Bearer allow-token' },
  });
  assert.equal(branchRead.statusCode, 200);

  const forwardedAuthCalls = calls.filter((c) =>
    (c.target.includes('/orgs') || c.target.includes('/members')) &&
    !c.target.includes('/internal/') &&
    !c.target.includes('/memberships/me?')
  );
  assert.equal(forwardedAuthCalls.every((c) => c.options.headers?.authorization === 'Bearer allow-token'), true);

  const rbacBodies = calls
    .filter((c) => c.target.includes('/rbac/check'))
    .map((c) => JSON.parse(c.options.body));
  const orgScoped = rbacBodies.find((body) => body.permissionKey === 'org.read');
  assert.equal(orgScoped.organizationId, 'org-1');
  const branchScoped = rbacBodies.find((body) => body.permissionKey === 'org.branch.read' && body.branchId === 'branch-9');
  assert.equal(branchScoped.organizationId, 'org-1');
  assert.equal(branchScoped.branchId, 'branch-9');
});
