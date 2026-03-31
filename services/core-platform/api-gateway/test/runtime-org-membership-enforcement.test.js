const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJwt(sub, roles = []) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ sub, roles }));
  return `${header}.${payload}.sig`;
}

function readSubFromAuthorization(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return payload?.sub || null;
}

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
  const allowToken = makeJwt('user-allow');
  const deniedToken = makeJwt('user-denied');
  const memberlessToken = makeJwt('user-no-membership');
  const branchMissToken = makeJwt('user-branch-miss');

  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      calls.push({ target, options });

      if (target.includes('/rbac/check')) {
        const userId = readSubFromAuthorization(options.headers?.authorization || '');
        const allowed = userId !== 'user-denied';
        return rbacResponse(allowed);
      }

      if (target.includes('/memberships/me?')) {
        if (target.includes('userId=user-no-membership')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ allowed: false, membership: null, assignments: [] }),
          };
        }
        if (target.includes('userId=user-branch-miss') && target.includes('branchId=branch-missing')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ allowed: false, membership: { membershipId: 'm2' }, assignments: [] }),
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
    headers: { authorization: `Bearer ${deniedToken}` },
  });
  assert.equal(denied.statusCode, 403);

  const notMember = await app.inject({
    method: 'GET',
    url: '/orgs/org-1',
    headers: { authorization: `Bearer ${memberlessToken}` },
  });
  assert.equal(notMember.statusCode, 403);
  assert.equal(notMember.json().message, 'Not a member of this organization');

  const notBranchMember = await app.inject({
    method: 'GET',
    url: '/orgs/org-1/branches/branch-missing',
    headers: { authorization: `Bearer ${branchMissToken}` },
  });
  assert.equal(notBranchMember.statusCode, 403);

  const orgCreate = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: `Bearer ${allowToken}` },
    payload: { name: 'North Hospital', type: 'hospital', ownerNin: '90000000001' },
  });
  assert.equal(orgCreate.statusCode, 201);

  const invite = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${allowToken}` },
    payload: { nin: '90000000001', roles: ['doctor'], branchIds: ['b1'] },
  });
  assert.equal(invite.statusCode, 201);

  const transfer = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/members/member-1/transfer',
    headers: { authorization: `Bearer ${allowToken}` },
    payload: { fromBranchId: 'a', toBranchId: 'b' },
  });
  assert.equal(transfer.statusCode, 200);

  const branchRead = await app.inject({
    method: 'GET',
    url: '/orgs/org-1/branches/branch-9',
    headers: { authorization: `Bearer ${allowToken}` },
  });
  assert.equal(branchRead.statusCode, 200);

  const forwardedAuthCalls = calls.filter((c) =>
    (c.target.includes('/orgs') || c.target.includes('/members')) &&
    !c.target.includes('/internal/') &&
    !c.target.includes('/memberships/me?')
  );
  assert.equal(forwardedAuthCalls.every((c) => c.options.headers?.authorization === `Bearer ${allowToken}`), true);

  const rbacBodies = calls
    .filter((c) => c.target.includes('/rbac/check'))
    .map((c) => JSON.parse(c.options.body));
  const orgScoped = rbacBodies.find((body) => body.permissionKey === 'org.read');
  assert.equal(orgScoped.organizationId, 'org-1');
  const branchScoped = rbacBodies.find((body) => body.permissionKey === 'org.branch.read' && body.branchId === 'branch-9');
  assert.equal(branchScoped.organizationId, 'org-1');
  assert.equal(branchScoped.branchId, 'branch-9');
});

test('runtime gateway accepts global service writes through manage fallback', async () => {
  const calls = [];
  const allowToken = makeJwt('user-allow');

  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      calls.push({ target, options });

      if (target.includes('/rbac/check')) {
        const body = JSON.parse(String(options.body || '{}'));
        const allowed = body.permissionKey === 'global.services.manage';
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            allowed,
            userId: 'user-allow',
            reason: allowed ? null : 'Permission denied',
          }),
          headers: { get: () => 'application/json' },
        };
      }

      if (target.includes('/memberships/me?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: true, membership: { membershipId: 'm1' }, assignments: [] }),
        };
      }

      if (target.includes('/global-services/service-1') && options.method === 'PATCH') {
        return downstreamResponse(200, { service: { serviceId: 'service-1', name: 'Imaging' } });
      }

      if (target.includes('/global-services/service-1') && options.method === 'DELETE') {
        return downstreamResponse(200, { message: 'deleted' });
      }

      if (target.includes('/internal/audit/events')) {
        return downstreamResponse(202, { accepted: true });
      }

      return downstreamResponse(200, {});
    },
  });

  const update = await app.inject({
    method: 'PATCH',
    url: '/global-services/service-1',
    headers: {
      authorization: `Bearer ${allowToken}`,
      'x-org-id': 'org-1',
    },
    payload: {
      name: 'Imaging',
      description: 'Diagnostic imaging and scan support.',
    },
  });
  assert.equal(update.statusCode, 200);

  const remove = await app.inject({
    method: 'DELETE',
    url: '/global-services/service-1',
    headers: {
      authorization: `Bearer ${allowToken}`,
      'x-org-id': 'org-1',
    },
    payload: {},
  });
  assert.equal(remove.statusCode, 200);

  const rbacChecks = calls
    .filter((entry) => entry.target.includes('/rbac/check'))
    .map((entry) => JSON.parse(String(entry.options.body || '{}')).permissionKey);

  assert.deepEqual(rbacChecks, [
    'global.services.update',
    'global.services.manage',
    'global.services.delete',
    'global.services.manage',
  ]);
});

test('runtime gateway accepts theme listing through write fallback', async () => {
  const calls = [];
  const allowToken = makeJwt('user-allow');

  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      calls.push({ target, options });

      if (target.includes('/rbac/check')) {
        const body = JSON.parse(String(options.body || '{}'));
        const allowed = body.permissionKey === 'ui.theme.write';
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            allowed,
            userId: 'user-allow',
            reason: allowed ? null : 'Permission denied',
          }),
          headers: { get: () => 'application/json' },
        };
      }

      if (target.includes('/memberships/me?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: true, membership: { membershipId: 'm1' }, assignments: [] }),
        };
      }

      if (target.includes('/ui/theme') && options.method === 'GET') {
        return downstreamResponse(200, [{ id: 'theme-1', scopeType: 'organization', scopeId: 'org-1', themeTokens: {} }]);
      }

      if (target.includes('/internal/audit/events')) {
        return downstreamResponse(202, { accepted: true });
      }

      return downstreamResponse(200, {});
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/ui/theme?scope_type=organization&scope_id=org-1',
    headers: {
      authorization: `Bearer ${allowToken}`,
      'x-org-id': 'org-1',
    },
  });

  assert.equal(res.statusCode, 200);
  const rbacChecks = calls
    .filter((entry) => entry.target.includes('/rbac/check'))
    .map((entry) => JSON.parse(String(entry.options.body || '{}')).permissionKey);

  assert.deepEqual(rbacChecks, ['ui.theme.read', 'ui.theme.write']);
});

test('runtime gateway proxies org permission delete route', async () => {
  const calls = [];
  const allowToken = makeJwt('user-allow');

  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      calls.push({ target, options });

      if (target.includes('/rbac/check')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            allowed: true,
            userId: 'user-allow',
            reason: null,
          }),
          headers: { get: () => 'application/json' },
        };
      }

      if (target.includes('/memberships/me?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: true, membership: { membershipId: 'm1' }, assignments: [] }),
        };
      }

      if (target.includes('/rbac/org/org-1/permissions/custom.permission') && options.method === 'DELETE') {
        return downstreamResponse(200, { message: 'Org permission deleted' });
      }

      if (target.includes('/internal/audit/events')) {
        return downstreamResponse(202, { accepted: true });
      }

      return downstreamResponse(200, {});
    },
  });

  const res = await app.inject({
    method: 'DELETE',
    url: '/rbac/org/org-1/permissions/custom.permission',
    headers: {
      authorization: `Bearer ${allowToken}`,
      'x-org-id': 'org-1',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(
    calls.some((entry) =>
      entry.target.includes('/rbac/org/org-1/permissions/custom.permission') && entry.options.method === 'DELETE'),
    true,
  );
});

test('spoofed super context header does not bypass gateway authorization', async () => {
  const deniedToken = makeJwt('user-denied');
  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/memberships/me?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: true, membership: { membershipId: 'm1' }, assignments: [] }),
        };
      }
      if (target.includes('/rbac/check')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ allowed: false, userId: 'user-denied', reason: 'Permission denied' }),
        };
      }
      if (target.includes('/internal/audit/events')) {
        return downstreamResponse(202, { accepted: true });
      }
      return downstreamResponse(200, { ok: true });
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/orgs/org-1',
    headers: {
      authorization: `Bearer ${deniedToken}`,
      'x-active-context-id': 'app:super',
      'x-active-context-name': 'Super Admin',
      'x-active-context-type': 'super',
    },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().message, 'Access denied');
});

test('real super role in token still bypasses gateway authorization checks', async () => {
  const superToken = makeJwt('user-super', ['super']);
  let membershipChecks = 0;
  let rbacChecks = 0;
  const app = await buildApp({
    dbReady: true,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/memberships/me?')) {
        membershipChecks += 1;
      }
      if (target.includes('/rbac/check')) {
        rbacChecks += 1;
      }
      if (target.includes('/orgs/org-1')) {
        return downstreamResponse(200, { message: 'org read' });
      }
      if (target.includes('/internal/audit/events')) {
        return downstreamResponse(202, { accepted: true });
      }
      return downstreamResponse(200, {});
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/orgs/org-1',
    headers: {
      authorization: `Bearer ${superToken}`,
      'x-active-context-id': 'app:super',
      'x-active-context-name': 'Super Admin',
      'x-active-context-type': 'super',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(membershipChecks, 0);
  assert.equal(rbacChecks, 0);
});
