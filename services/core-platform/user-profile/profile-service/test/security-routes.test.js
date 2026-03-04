const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
process.env.MEMBERSHIP_API_BASE_URL = 'http://membership-service:8103';
const { buildApp } = require('../src/server');

test('GET /profile/me enforces profile.me.read permission', () => {
  const serverPath = path.resolve(__dirname, '../src/server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const routeBlockPattern = /fastify\.get\('\/profile\/me'[\s\S]*?async \(req, reply\) => \{[\s\S]*?enforcePermission\(req, reply, 'profile\.me\.read'\)/;
  assert.equal(routeBlockPattern.test(source), true);
});

function makeFakeDb() {
  const profiles = new Map();
  return {
    collection(name) {
      if (name !== 'user_profiles') {
        return {
          findOne: async () => null,
          updateOne: async () => ({ acknowledged: true }),
          find: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
          countDocuments: async () => 0,
        };
      }
      return {
        findOne: async (query) => {
          if (query.userId) return profiles.get(query.userId) || null;
          if (query.nin) return Array.from(profiles.values()).find((p) => p.nin === query.nin) || null;
          return null;
        },
        updateOne: async (query, update) => {
          const existing = profiles.get(query.userId) || {};
          profiles.set(query.userId, { ...existing, ...(update.$set || {}) });
          return { acknowledged: true };
        },
        find: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
        countDocuments: async () => 0,
      };
    },
  };
}

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeAccessToken(payload, secret = 'change-me') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

test('runtime: GET /profile/me returns 403 when profile.me.read denied and does not call auth /me', { concurrency: false }, async () => {
  let authMeCalled = false;
  const fetchImpl = async (url) => {
    if (String(url).includes('/rbac/check')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ allowed: false, reason: 'Permission denied' }),
      };
    }
    if (String(url).includes('/me')) {
      authMeCalled = true;
      throw new Error('auth /me should not be called when permission denied');
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: true, db: makeFakeDb(), fetchImpl });
  const token = makeAccessToken({ sub: 'user-denied', roles: ['citizen'], type: 'access' }, 'change-me');
  const res = await app.inject({
    method: 'GET',
    url: '/profile/me',
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(authMeCalled, false);
});

test('runtime: GET /profile/me returns 200 when profile.me.read allowed', { concurrency: false }, async () => {
  let authMeCalled = false;
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.endsWith('/me')) {
      authMeCalled = true;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          user: {
            id: 'user-allow',
            nin: '90000000001',
            email: 'allowed@example.com',
            phone: '08000000001',
            emailVerified: true,
            phoneVerified: true,
            passwordSetAt: new Date().toISOString(),
            requiresPasswordChange: false,
          },
        }),
      };
    }
    if (target.includes('/nin/')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000001', firstName: 'Test' }) };
    }
    if (target.includes('/rbac/me/scope')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ appScopePermissions: [] }) };
    }
    if (target.includes('/users/user-allow/memberships?includeBranches=true')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          memberships: [
            {
              organizationId: 'org-1',
              membershipId: 'mem-1',
              membershipStatus: 'active',
              roles: ['org_staff'],
              branches: [{ branchId: 'branch-1', roles: ['doctor'], departments: ['pediatrics'] }],
            },
          ],
        }),
      };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: true, db: makeFakeDb(), fetchImpl });
  const token = makeAccessToken({ sub: 'user-allow', roles: ['citizen'], type: 'access' }, 'change-me');
  const res = await app.inject({
    method: 'GET',
    url: '/profile/me',
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(authMeCalled, true);
  assert.equal(Array.isArray(res.json().membershipSummary.memberships), true);
  assert.equal(res.json().membershipSummary.memberships[0].organizationId, 'org-1');
});

test('runtime: GET /profile/me returns 200 with membershipSummary null when membership service fails', { concurrency: false }, async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.endsWith('/me')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          user: {
            id: 'user-membership-down',
            nin: '90000000001',
            passwordSetAt: new Date().toISOString(),
            requiresPasswordChange: false,
          },
        }),
      };
    }
    if (target.includes('/nin/')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000001', firstName: 'Test' }) };
    }
    if (target.includes('/rbac/me/scope')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ appScopePermissions: [] }) };
    }
    if (target.includes('/users/user-membership-down/memberships?includeBranches=true')) {
      return { ok: false, status: 503, text: async () => JSON.stringify({ message: 'down' }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: true, db: makeFakeDb(), fetchImpl });
  const token = makeAccessToken({ sub: 'user-membership-down', roles: ['citizen'], type: 'access' }, 'change-me');
  const res = await app.inject({
    method: 'GET',
    url: '/profile/me',
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().membershipSummary, null);
});
