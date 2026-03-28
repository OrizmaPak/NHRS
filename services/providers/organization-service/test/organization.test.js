const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.NODE_ENV = 'development';
process.env.NHRS_CONTEXT_ALLOW_LEGACY = 'true';
const { buildApp } = require('../src/server');

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeAccessToken(payload, secret = 'change-me') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${signature}`;
}

function getValueByPath(doc, path) {
  const parts = String(path || '').split('.');
  let current = doc;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function matchCondition(value, condition) {
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    if (Object.prototype.hasOwnProperty.call(condition, '$exists')) {
      const exists = value !== undefined;
      return Boolean(condition.$exists) ? exists : !exists;
    }
    if (Object.prototype.hasOwnProperty.call(condition, '$ne')) {
      return value !== condition.$ne;
    }
    if (condition.$in) {
      return condition.$in.includes(value);
    }
    if (condition.$regex !== undefined) {
      const regex = new RegExp(String(condition.$regex), condition.$options || '');
      return regex.test(String(value ?? ''));
    }
  }
  return value === condition;
}

function matchesQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;
  if (query.$and) {
    return query.$and.every((entry) => matchesQuery(doc, entry));
  }
  if (query.$or) {
    return query.$or.some((entry) => matchesQuery(doc, entry));
  }
  return Object.entries(query).every(([key, condition]) => {
    if (key === '$and' || key === '$or') return true;
    const value = getValueByPath(doc, key);
    return matchCondition(value, condition);
  });
}

function makeFakeDb() {
  const organizations = [];
  const institutions = [];
  const history = [];
  const branches = [];

  return {
    collection(name) {
      if (name === 'organizations') {
        return {
          insertOne: async (doc) => { organizations.push(structuredClone(doc)); return { acknowledged: true }; },
          findOne: async (query) => organizations.find((item) => item.organizationId === query.organizationId) || null,
          updateOne: async (query, update) => {
            const idx = organizations.findIndex((item) => item.organizationId === query.organizationId);
            if (idx >= 0) organizations[idx] = { ...organizations[idx], ...(update.$set || {}) };
            return { acknowledged: true };
          },
          findOneAndUpdate: async (query, update) => {
            const idx = organizations.findIndex((item) => item.organizationId === query.organizationId);
            if (idx < 0) return { value: null };
            organizations[idx] = { ...organizations[idx], ...(update.$set || {}) };
            return { value: structuredClone(organizations[idx]) };
          },
          find: (query = {}) => ({
            skip: (offset = 0) => ({
              limit: (size = organizations.length) => ({
                toArray: async () => structuredClone(organizations.filter((item) => matchesQuery(item, query)).slice(offset, offset + size)),
              }),
            }),
            toArray: async () => structuredClone(organizations.filter((item) => matchesQuery(item, query))),
          }),
          countDocuments: async (query = {}) => organizations.filter((item) => matchesQuery(item, query)).length,
          createIndex: async () => ({}),
        };
      }
      if (name === 'organization_owner_history') {
        return {
          insertOne: async (doc) => { history.push(structuredClone(doc)); return { acknowledged: true }; },
          createIndex: async () => ({}),
        };
      }
      if (name === 'institutions') {
        return {
          insertOne: async (doc) => { institutions.push(structuredClone(doc)); return { acknowledged: true }; },
          findOne: async (query) => institutions.find((item) => {
            if (query.institutionId) return item.organizationId === query.organizationId && item.institutionId === query.institutionId;
            if (query.organizationId && query.code) return item.organizationId === query.organizationId && item.code === query.code;
            return false;
          }) || null,
          findOneAndUpdate: async (query, update) => {
            const idx = institutions.findIndex((item) => item.organizationId === query.organizationId && item.institutionId === query.institutionId);
            if (idx < 0) return { value: null };
            institutions[idx] = { ...institutions[idx], ...(update.$set || {}) };
            return { value: structuredClone(institutions[idx]) };
          },
          find: (query) => ({
            toArray: async () => structuredClone(institutions.filter((item) => {
              return matchesQuery(item, query || {});
            })),
          }),
          updateMany: async (query, update) => {
            let modified = 0;
            for (let idx = 0; idx < institutions.length; idx += 1) {
              if (!matchesQuery(institutions[idx], query || {})) continue;
              institutions[idx] = { ...institutions[idx], ...(update.$set || {}) };
              modified += 1;
            }
            return { modifiedCount: modified };
          },
          createIndex: async () => ({}),
        };
      }
      if (name === 'branches') {
        return {
          insertOne: async (doc) => { branches.push(structuredClone(doc)); return { acknowledged: true }; },
          find: (query = {}) => ({
            toArray: async () => structuredClone(branches.filter((b) => matchesQuery(b, query))),
            skip: (offset = 0) => ({
              limit: (size = branches.length) => ({
                toArray: async () => structuredClone(branches.filter((b) => matchesQuery(b, query)).slice(offset, offset + size)),
              }),
            }),
          }),
          findOne: async (query) => branches.find((b) => b.organizationId === query.organizationId && b.branchId === query.branchId) || null,
          findOneAndUpdate: async (query, update) => {
            const idx = branches.findIndex((b) => b.organizationId === query.organizationId && b.branchId === query.branchId);
            if (idx < 0) return { value: null };
            branches[idx] = { ...branches[idx], ...(update.$set || {}) };
            return { value: structuredClone(branches[idx]) };
          },
          updateMany: async (query, update) => {
            let modified = 0;
            for (let idx = 0; idx < branches.length; idx += 1) {
              if (!matchesQuery(branches[idx], query || {})) continue;
              branches[idx] = { ...branches[idx], ...(update.$set || {}) };
              modified += 1;
            }
            return { modifiedCount: modified };
          },
          countDocuments: async (query = {}) => branches.filter((item) => matchesQuery(item, query)).length,
          createIndex: async () => ({}),
        };
      }
      return { createIndex: async () => ({}) };
    },
  };
}

test('create org supports creator different from owner', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  };

  const app = buildApp({ dbReady: true, db: makeFakeDb(), fetchImpl });
  const token = makeAccessToken({ sub: 'creator-1' }, 'change-me');

  const res = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: 'Central Hospital',
      location: { state: 'Lagos', lga: 'Ikeja' },
      ownerUserId: 'owner-777',
    },
  });

  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.organization.createdByUserId, 'creator-1');
  assert.equal(body.organization.ownerUserId, 'owner-777');
});

test('organization list is limited to owner/affiliated scope', async () => {
  const fakeDb = makeFakeDb();
  const app = buildApp({
    dbReady: true,
    db: fakeDb,
    fetchImpl: async (url) => {
      if (String(url).includes('/rbac/check')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ memberships: [] }) };
    },
  });

  const ownerToken = makeAccessToken({ sub: 'owner-1' }, 'change-me');
  const otherToken = makeAccessToken({ sub: 'viewer-2' }, 'change-me');

  const createRes = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: 'Scoped Org', location: { state: 'Lagos', lga: 'Ikeja' } },
  });
  assert.equal(createRes.statusCode, 201);

  const ownerList = await app.inject({
    method: 'GET',
    url: '/orgs?page=1&limit=20',
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(ownerList.statusCode, 200);
  assert.equal(ownerList.json().total, 1);

  const otherList = await app.inject({
    method: 'GET',
    url: '/orgs?page=1&limit=20',
    headers: { authorization: `Bearer ${otherToken}` },
  });
  assert.equal(otherList.statusCode, 200);
  assert.equal(otherList.json().total, 0);
  assert.equal(Array.isArray(otherList.json().items), true);
  assert.equal(otherList.json().items.length, 0);
});

test('organization list does not trust spoofed super context headers', async () => {
  const fakeDb = makeFakeDb();
  const app = buildApp({
    dbReady: true,
    db: fakeDb,
    fetchImpl: async (url) => {
      if (String(url).includes('/rbac/check')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ memberships: [] }) };
    },
  });

  const ownerToken = makeAccessToken({ sub: 'owner-1' }, 'change-me');
  const viewerToken = makeAccessToken({ sub: 'viewer-2' }, 'change-me');

  const createRes = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: 'Scoped Org', location: { state: 'Lagos', lga: 'Ikeja' } },
  });
  assert.equal(createRes.statusCode, 201);

  const res = await app.inject({
    method: 'GET',
    url: '/orgs?page=1&limit=20',
    headers: {
      authorization: `Bearer ${viewerToken}`,
      'x-active-context-id': 'app:super',
      'x-active-context-name': 'Super Admin',
      'x-active-context-type': 'super',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().total, 0);
  assert.equal(res.json().items.length, 0);
});

test('organization deletion request and review removes from active listing', async () => {
  const fakeDb = makeFakeDb();
  const app = buildApp({
    dbReady: true,
    db: fakeDb,
    fetchImpl: async (url) => {
      if (String(url).includes('/rbac/check')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ memberships: [] }) };
    },
  });
  const token = makeAccessToken({ sub: 'owner-del-1' }, 'change-me');

  const created = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Delete Me Org', location: { state: 'Lagos', lga: 'Ikeja' } },
  });
  assert.equal(created.statusCode, 201);
  const orgId = created.json().organization.organizationId;

  const requestDelete = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/deletion/request`,
    headers: { authorization: `Bearer ${token}` },
    payload: { reason: 'cleanup' },
  });
  assert.equal(requestDelete.statusCode, 200);

  const reviewDelete = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/deletion/review`,
    headers: { authorization: `Bearer ${token}` },
    payload: { decision: 'approve' },
  });
  assert.equal(reviewDelete.statusCode, 200);

  const activeList = await app.inject({
    method: 'GET',
    url: '/orgs?page=1&limit=20',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(activeList.statusCode, 200);
  assert.equal(activeList.json().total, 0);

  const deletedList = await app.inject({
    method: 'GET',
    url: '/orgs/deleted?page=1&limit=20',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(deletedList.statusCode, 200);
  assert.equal(deletedList.json().total, 1);
});

test('branch create and list works', async () => {
  const fakeDb = makeFakeDb();
  const app = buildApp({
    dbReady: true,
    db: fakeDb,
    fetchImpl: async (url) => {
      if (String(url).includes('/rbac/check')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    },
  });
  const token = makeAccessToken({ sub: 'creator-1' }, 'change-me');

  const orgRes = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'West Lab', location: { state: 'Lagos', lga: 'Ikeja' } },
  });

  const orgId = orgRes.json().organization.organizationId;
  const approveRes = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/approval`,
    headers: { authorization: `Bearer ${token}` },
    payload: { decision: 'approve' },
  });
  assert.equal(approveRes.statusCode, 200);

  const createInstitutionRes = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/institutions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'West Lab Main Institution', type: 'laboratory', code: 'WLMI' },
  });
  assert.equal(createInstitutionRes.statusCode, 201);
  const institutionId = createInstitutionRes.json().institution.institutionId;

  const branchRes = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Main Branch', code: 'MB1', institutionId },
  });

  assert.equal(branchRes.statusCode, 201);

  const listRes = await app.inject({
    method: 'GET',
    url: `/orgs/${orgId}/branches`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(Array.isArray(listRes.json().items), true);
  assert.equal(listRes.json().items.length, 1);
});

test('institution hierarchy endpoints work', async () => {
  const fakeDb = makeFakeDb();
  const app = buildApp({
    dbReady: true,
    db: fakeDb,
    fetchImpl: async (url) => {
      if (String(url).includes('/rbac/check')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    },
  });
  const token = makeAccessToken({ sub: 'creator-2' }, 'change-me');

  const orgRes = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'River Health Group', location: { state: 'Lagos', lga: 'Ikeja' } },
  });
  assert.equal(orgRes.statusCode, 201);
  const orgId = orgRes.json().organization.organizationId;
  const approveRes = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/approval`,
    headers: { authorization: `Bearer ${token}` },
    payload: { decision: 'approve' },
  });
  assert.equal(approveRes.statusCode, 200);

  const listInitial = await app.inject({
    method: 'GET',
    url: `/orgs/${orgId}/institutions`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(listInitial.statusCode, 200);
  assert.equal(Array.isArray(listInitial.json().items), true);
  assert.equal(listInitial.json().items.length, 0);

  const createInstitution = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/institutions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'River Specialist Center', type: 'clinic', code: 'RSC' },
  });
  assert.equal(createInstitution.statusCode, 201);
  const institutionId = createInstitution.json().institution.institutionId;

  const createBranch = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/institutions/${institutionId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'RSC East', code: 'RSC-E', capabilities: ['clinic'] },
  });
  assert.equal(createBranch.statusCode, 201);

  const hierarchy = await app.inject({
    method: 'GET',
    url: `/orgs/${orgId}/hierarchy`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(hierarchy.statusCode, 200);
  assert.equal(Array.isArray(hierarchy.json().institutions), true);
  assert.equal(Array.isArray(hierarchy.json().branches), true);
});
