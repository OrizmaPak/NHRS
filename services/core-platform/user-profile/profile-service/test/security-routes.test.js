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

test('PATCH /profile/:userId enforces profile.user.update permission', () => {
  const serverPath = path.resolve(__dirname, '../src/server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const routeBlockPattern = /fastify\.patch\('\/profile\/:userId'[\s\S]*?async \(req, reply\) => \{[\s\S]*?enforcePermission\(req, reply, 'profile\.user\.update'/;
  assert.equal(routeBlockPattern.test(source), true);
});

function makeFakeDb() {
  const profiles = new Map();

  function applySetFields(existing, setDoc = {}) {
    const next = { ...(existing || {}) };
    for (const [key, value] of Object.entries(setDoc)) {
      const parts = String(key || '').split('.').filter(Boolean);
      if (parts.length === 0) continue;
      let cursor = next;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        const current = cursor[part];
        cursor[part] = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
        cursor = cursor[part];
      }
      cursor[parts[parts.length - 1]] = value;
    }
    return next;
  }

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
          profiles.set(query.userId, applySetFields(existing, update.$set || {}));
          return { acknowledged: true };
        },
        find: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
        countDocuments: async () => 0,
      };
    },
  };
}

function makeSearchableFakeDb(seedProfiles = [], seedRegistry = []) {
  const profiles = new Map(seedProfiles.map((profile) => [profile.userId, { ...profile }]));
  const patientRegistry = new Map(
    seedRegistry.map((entry) => [`${entry.organizationId}::${entry.institutionId}::${entry.nin}`, { ...entry }]),
  );

  function applySetFields(existing, setDoc = {}) {
    const next = { ...(existing || {}) };
    for (const [key, value] of Object.entries(setDoc)) {
      const parts = String(key || '').split('.').filter(Boolean);
      if (parts.length === 0) continue;
      let cursor = next;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        const current = cursor[part];
        cursor[part] = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
        cursor = cursor[part];
      }
      cursor[parts[parts.length - 1]] = value;
    }
    return next;
  }

  function matchesFilter(profile, filter = {}) {
    if (!filter || typeof filter !== 'object') return true;
    if (filter.nin && profile.nin !== String(filter.nin)) return false;
    if (filter.phone && profile.phone !== String(filter.phone)) return false;
    if (filter.email && String(profile.email || '').toLowerCase() !== String(filter.email).toLowerCase()) return false;
    if (filter.organizationId && profile.organizationId !== String(filter.organizationId)) return false;
    if (filter.institutionId && profile.institutionId !== String(filter.institutionId)) return false;
    if (filter.professionTypes) {
      const professionTypes = Array.isArray(profile.professionTypes) ? profile.professionTypes : [];
      if (!professionTypes.includes(String(filter.professionTypes))) return false;
    }
    if (Array.isArray(filter.$or) && filter.$or.length > 0) {
      const matched = filter.$or.some((candidate) => {
        const [field, condition] = Object.entries(candidate || {})[0] || [];
        if (!field || !condition || typeof condition !== 'object') return false;
        const raw = String(profile[field] || '');
        const regex = new RegExp(condition.$regex, condition.$options || '');
        return regex.test(raw);
      });
      if (!matched) return false;
    }
    return true;
  }

  function query(sourceMap, filter = {}) {
    const rows = Array.from(sourceMap.values()).filter((profile) => matchesFilter(profile, filter));
    const buildSlice = (collectionRows) => ({
      toArray: async () => collectionRows,
      skip(offset) {
        const start = Number(offset) || 0;
        return {
          limit(limit) {
            const end = start + (Number(limit) || collectionRows.length);
            return {
              toArray: async () => collectionRows.slice(start, end),
            };
          },
        };
      },
      limit(limit) {
        const end = Number(limit) || collectionRows.length;
        return {
          toArray: async () => collectionRows.slice(0, end),
        };
      },
    });

    return {
      toArray: async () => rows,
      sort(sortSpec = {}) {
        const [[field = 'updatedAt', direction = -1] = []] = Object.entries(sortSpec);
        const sortedRows = [...rows].sort((left, right) => {
          const leftValue = new Date(left[field] || left.createdAt || 0).getTime();
          const rightValue = new Date(right[field] || right.createdAt || 0).getTime();
          return direction >= 0 ? leftValue - rightValue : rightValue - leftValue;
        });
        return buildSlice(sortedRows);
      },
      skip(offset) {
        const start = Number(offset) || 0;
        return {
          limit(limit) {
            const end = start + (Number(limit) || rows.length);
            return {
              toArray: async () => rows.slice(start, end),
            };
          },
        };
      },
      limit(limit) {
        const end = Number(limit) || rows.length;
        return {
          toArray: async () => rows.slice(0, end),
        };
      },
    };
  }

  return {
    collection(name) {
      if (name === 'care_patient_registry') {
        return {
          findOne: async (filter) => {
            if (filter.organizationId && filter.nin) {
              return patientRegistry.get(`${filter.organizationId}::${filter.nin}`) || null;
            }
            return Array.from(patientRegistry.values()).find((entry) => matchesFilter(entry, filter)) || null;
          },
          updateOne: async (filter, update, options = {}) => {
            const key = `${filter.organizationId}::${filter.nin}`;
            const existing = patientRegistry.get(key) || {};
            const next = {
              ...existing,
              ...(update.$setOnInsert || (options.upsert && !patientRegistry.has(key) ? update.$setOnInsert || {} : {})),
              ...(update.$set || {}),
            };
            patientRegistry.set(key, next);
            return { acknowledged: true };
          },
          replaceOne: async (filter, replacement) => {
            const existingKey = Array.from(patientRegistry.entries()).find(([, entry]) => matchesFilter(entry, filter))?.[0];
            const key = existingKey || `${replacement.organizationId}::${replacement.nin}`;
            patientRegistry.set(key, { ...replacement });
            return { acknowledged: true };
          },
          deleteMany: async (filter) => {
            const ids = Array.isArray(filter?._id?.$in) ? filter._id.$in : [];
            for (const [key, entry] of patientRegistry.entries()) {
              if (ids.includes(entry?._id)) {
                patientRegistry.delete(key);
              }
            }
            return { acknowledged: true };
          },
          find: (filter) => query(patientRegistry, filter),
          countDocuments: async (filter = {}) => Array.from(patientRegistry.values()).filter((entry) => matchesFilter(entry, filter)).length,
        };
      }
      if (name !== 'user_profiles') {
        return {
          findOne: async () => null,
          updateOne: async () => ({ acknowledged: true }),
          find: () => query(new Map(), {}),
          countDocuments: async () => 0,
        };
      }
      return {
        findOne: async (filter) => {
          if (filter.userId) return profiles.get(filter.userId) || null;
          if (filter.nin) {
            return Array.from(profiles.values()).find((profile) => profile.nin === String(filter.nin)) || null;
          }
          return null;
        },
        updateOne: async (filter, update) => {
          const existing = profiles.get(filter.userId) || {};
          profiles.set(filter.userId, applySetFields(existing, update.$set || {}));
          return { acknowledged: true };
        },
        find: (filter) => query(profiles, filter),
        countDocuments: async (filter = {}) => Array.from(profiles.values()).filter((profile) => matchesFilter(profile, filter)).length,
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

test('runtime: GET /profile/search patient-care view bypasses org staff-only filtering but still requires care read permission', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([
    {
      userId: 'patient-1',
      nin: '90000000009',
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      professionTypes: [],
      profileStatus: 'active',
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.includes('/members?')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [], total: 0 }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'org-owner', roles: ['citizen'], type: 'access' }, 'change-me');

  const standardRes = await app.inject({
    method: 'GET',
    url: '/profile/search?nin=90000000009',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
    },
  });

  const patientViewRes = await app.inject({
    method: 'GET',
    url: '/profile/search?nin=90000000009&view=patient-care',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
    },
  });

  assert.equal(standardRes.statusCode, 200);
  assert.equal(standardRes.json().total, 0);
  assert.equal(patientViewRes.statusCode, 200);
  assert.equal(patientViewRes.json().total, 1);
  assert.equal(patientViewRes.json().items[0].nin, '90000000009');
});

test('runtime: GET /profile/search patient-care view can infer organizationId from active context id', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([
    {
      userId: 'patient-2',
      nin: '90000000010',
      displayName: 'Grace Hopper',
      firstName: 'Grace',
      lastName: 'Hopper',
      profileStatus: 'active',
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'org-owner', roles: ['citizen'], type: 'access' }, 'change-me');

  const res = await app.inject({
    method: 'GET',
    url: '/profile/search?nin=90000000010&view=patient-care',
    headers: {
      authorization: `Bearer ${token}`,
      'x-active-context-id': 'org:org-1:role:owner',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().total, 1);
  assert.equal(res.json().items[0].nin, '90000000010');
});

test('runtime: GET /profile/by-nin patient-care view can read patient profile outside org staff list', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([
    {
      userId: 'patient-1',
      nin: '90000000009',
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      profileStatus: 'active',
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.includes('/members?')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [], total: 0 }) };
    }
    if (target.includes('/nin/90000000009')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000009', firstName: 'Ada', lastName: 'Lovelace' }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'org-owner', roles: ['citizen'], type: 'access' }, 'change-me');

  const standardRes = await app.inject({
    method: 'GET',
    url: '/profile/by-nin/90000000009',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
    },
  });

  const patientViewRes = await app.inject({
    method: 'GET',
    url: '/profile/by-nin/90000000009?view=patient-care',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
    },
  });

  assert.equal(standardRes.statusCode, 200);
  assert.equal(standardRes.json().registered, false);
  assert.equal(patientViewRes.statusCode, 200);
  assert.equal(patientViewRes.json().registered, true);
  assert.equal(patientViewRes.json().profile.nin, '90000000009');
});

test('runtime: GET /profile/by-nin replaces synthetic NIN display names with real patient names and intake details', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([
    {
      userId: 'patient-2',
      nin: '90000000014',
      displayName: 'NIN 90000000014',
      firstName: 'Ngozi',
      lastName: 'Okafor',
      nationality: null,
      stateOfOrigin: null,
      localGovernment: null,
      profileStatus: 'active',
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.includes('/nin/90000000014')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          nin: '90000000014',
          fullName: 'Ngozi Okafor',
          firstName: 'Ngozi',
          lastName: 'Okafor',
          gender: 'female',
          nationality: 'Nigeria',
          stateOfOrigin: 'Anambra',
          localGovernment: 'Awka South',
          addressText: 'Awka, Anambra',
        }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'institution-manager', roles: ['citizen'], type: 'access' }, 'change-me');

  const res = await app.inject({
    method: 'GET',
    url: '/profile/by-nin/90000000014?view=patient-care',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
      'x-institution-id': 'inst-1',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().registered, true);
  assert.equal(res.json().profile.displayName, 'Ngozi Okafor');
  assert.equal(res.json().profile.gender, 'female');
  assert.equal(res.json().profile.nationality, 'Nigeria');
  assert.equal(res.json().profile.stateOfOrigin, 'Anambra');
  assert.equal(res.json().profile.localGovernment, 'Awka South');
  assert.equal(res.json().profile.addressText, 'Awka, Anambra');
});

test('runtime: POST /care/patients registers patient into organization care search with NIN-backed name', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([]);
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.includes('/nin/90000000011')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          nin: '90000000011',
          firstName: 'Mary',
          otherName: 'Jane',
          lastName: 'Doe',
          gender: 'female',
        }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'institution-manager', roles: ['citizen'], type: 'access' }, 'change-me');

  const res = await app.inject({
    method: 'POST',
    url: '/care/patients',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
      'x-institution-id': 'inst-1',
    },
    payload: { nin: '90000000011', branchId: 'branch-1' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json().patient.nin, '90000000011');
  assert.equal(res.json().patient.displayName, 'Mary Jane Doe');
  assert.equal(res.json().patient.institutionId, 'inst-1');
  assert.deepEqual(res.json().patient.institutionIds, ['inst-1']);
  assert.equal(res.json().patient.branchId, 'branch-1');
  assert.deepEqual(res.json().patient.branchIds, ['branch-1']);
});

test('runtime: POST /care/patients ignores synthetic NIN display names when profile already has real names', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([
    {
      userId: 'patient-3',
      nin: '90000000015',
      displayName: 'NIN 90000000015',
      firstName: 'Chioma',
      lastName: 'Eze',
      profileStatus: 'active',
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.includes('/nin/90000000015')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          nin: '90000000015',
          gender: 'female',
        }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'institution-manager', roles: ['citizen'], type: 'access' }, 'change-me');

  const res = await app.inject({
    method: 'POST',
    url: '/care/patients',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
      'x-institution-id': 'inst-1',
    },
    payload: { nin: '90000000015' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json().patient.nin, '90000000015');
  assert.equal(res.json().patient.displayName, 'Chioma Eze');
  assert.equal(res.json().patient.gender, 'female');
});

test('runtime: GET /care/patients returns organization-wide registered patients even in institution context', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([], [
    {
      registryId: 'reg-1',
      organizationId: 'org-1',
      institutionId: 'inst-1',
      institutionIds: ['inst-1'],
      nin: '90000000012',
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      createdAt: new Date('2026-03-30T08:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-03-30T08:00:00.000Z').toISOString(),
    },
    {
      registryId: 'reg-2',
      organizationId: 'org-1',
      institutionId: 'inst-2',
      institutionIds: ['inst-2'],
      nin: '90000000013',
      displayName: 'Grace Hopper',
      firstName: 'Grace',
      lastName: 'Hopper',
      createdAt: new Date('2026-03-30T09:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-03-30T09:00:00.000Z').toISOString(),
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'institution-manager', roles: ['citizen'], type: 'access' }, 'change-me');

  const res = await app.inject({
    method: 'GET',
    url: '/care/patients?page=1&limit=10',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
      'x-institution-id': 'inst-1',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().total, 2);
  assert.deepEqual(res.json().items.map((entry) => entry.nin), ['90000000013', '90000000012']);
});

test('runtime: PATCH /profile/me only fills blank self-editable fields', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([
    {
      userId: 'citizen-1',
      nin: '90000000020',
      displayName: 'Existing Name',
      otherName: null,
      dob: null,
      gender: 'female',
      nationality: null,
      stateOfOrigin: 'Lagos',
      localGovernment: null,
      address: {
        country: 'Nigeria',
        state: null,
        lga: null,
        city: null,
        line1: null,
        line2: null,
        postalCode: null,
      },
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'citizen-1', roles: ['citizen'], type: 'access' }, 'change-me');

  const res = await app.inject({
    method: 'PATCH',
    url: '/profile/me',
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: {
      displayName: 'New Display Name',
      otherName: 'Brewster',
      dob: '1990-01-01',
      gender: 'male',
      nationality: 'Nigeria',
      stateOfOrigin: 'Oyo',
      localGovernment: 'Ibadan North',
      address: {
        country: 'Ghana',
        state: 'Oyo',
        city: 'Ibadan',
        line1: '12 Health Avenue',
      },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().message, 'Profile updated');
  assert.equal(res.json().profile.displayName, 'Existing Name');
  assert.equal(res.json().profile.otherName, 'Brewster');
  assert.equal(res.json().profile.dob, '1990-01-01');
  assert.equal(res.json().profile.gender, 'female');
  assert.equal(res.json().profile.nationality, 'Nigeria');
  assert.equal(res.json().profile.stateOfOrigin, 'Lagos');
  assert.equal(res.json().profile.localGovernment, 'Ibadan North');
  assert.equal(res.json().profile.address.country, 'Nigeria');
  assert.equal(res.json().profile.address.state, 'Oyo');
  assert.equal(res.json().profile.address.city, 'Ibadan');
  assert.equal(res.json().profile.address.line1, '12 Health Avenue');
});

test('runtime: PATCH /profile/:userId only fills blank managed fields', { concurrency: false }, async () => {
  const db = makeSearchableFakeDb([
    {
      userId: 'staff-1',
      nin: '90000000021',
      displayName: 'Existing Name',
      firstName: 'Ada',
      lastName: null,
      otherName: null,
      dob: null,
      gender: 'female',
      phone: null,
      email: 'ada@example.com',
      professionTypes: ['doctor'],
      profileStatus: 'pending',
      address: {
        country: 'Nigeria',
        state: null,
        lga: null,
        city: null,
        line1: null,
        line2: null,
        postalCode: null,
      },
      preferences: {
        notificationChannels: ['sms'],
        language: null,
      },
    },
  ]);

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.includes('/orgs/org-1/members?')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          items: [{ userId: 'staff-1', nin: '90000000021' }],
          total: 1,
        }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, redisReady: false, db, fetchImpl });
  const token = makeAccessToken({ sub: 'org-owner', roles: ['citizen'], type: 'access' }, 'change-me');

  const res = await app.inject({
    method: 'PATCH',
    url: '/profile/staff-1?organizationId=org-1',
    headers: {
      authorization: `Bearer ${token}`,
      'x-org-id': 'org-1',
    },
    payload: {
      displayName: 'New Display Name',
      firstName: 'Grace',
      lastName: 'Hopper',
      otherName: 'Brewster',
      dob: '1990-01-01',
      gender: 'male',
      phone: '08000000021',
      email: 'new@example.com',
      professionTypes: ['nurse'],
      address: {
        country: 'Ghana',
        state: 'Lagos',
        city: 'Ikeja',
        line1: '12 Health Avenue',
      },
      preferences: {
        notificationChannels: ['email'],
        language: 'en',
      },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().message, 'Profile updated');
  assert.equal(res.json().profile.displayName, 'Existing Name');
  assert.equal(res.json().profile.firstName, 'Ada');
  assert.equal(res.json().profile.lastName, 'Hopper');
  assert.equal(res.json().profile.otherName, 'Brewster');
  assert.equal(res.json().profile.dob, '1990-01-01');
  assert.equal(res.json().profile.gender, 'female');
  assert.equal(res.json().profile.phone, '08000000021');
  assert.equal(res.json().profile.email, 'ada@example.com');
  assert.deepEqual(res.json().profile.professionTypes, ['doctor']);
  assert.equal(res.json().profile.address.country, 'Nigeria');
  assert.equal(res.json().profile.address.state, 'Lagos');
  assert.equal(res.json().profile.address.city, 'Ikeja');
  assert.equal(res.json().profile.address.line1, '12 Health Avenue');
  assert.deepEqual(res.json().profile.preferences.notificationChannels, ['sms']);
  assert.equal(res.json().profile.preferences.language, 'en');
});
