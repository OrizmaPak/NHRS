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
          find: () => ({ skip: () => ({ limit: () => ({ toArray: async () => structuredClone(organizations) }) }) }),
          countDocuments: async () => organizations.length,
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
              if (query.organizationId && item.organizationId !== query.organizationId) return false;
              if (query.institutionId?.$in && !query.institutionId.$in.includes(item.institutionId)) return false;
              return true;
            })),
          }),
          createIndex: async () => ({}),
        };
      }
      if (name === 'branches') {
        return {
          insertOne: async (doc) => { branches.push(structuredClone(doc)); return { acknowledged: true }; },
          find: (query) => ({ toArray: async () => structuredClone(branches.filter((b) => b.organizationId === query.organizationId)) }),
          findOne: async (query) => branches.find((b) => b.organizationId === query.organizationId && b.branchId === query.branchId) || null,
          findOneAndUpdate: async (query, update) => {
            const idx = branches.findIndex((b) => b.organizationId === query.organizationId && b.branchId === query.branchId);
            if (idx < 0) return { value: null };
            branches[idx] = { ...branches[idx], ...(update.$set || {}) };
            return { value: structuredClone(branches[idx]) };
          },
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
      type: 'hospital',
      ownerUserId: 'owner-777',
    },
  });

  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.organization.createdByUserId, 'creator-1');
  assert.equal(body.organization.ownerUserId, 'owner-777');
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
    payload: { name: 'West Lab', type: 'laboratory', ownerNin: '90000000001' },
  });

  const orgId = orgRes.json().organization.organizationId;
  const approveRes = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/approval`,
    headers: { authorization: `Bearer ${token}` },
    payload: { decision: 'approve' },
  });
  assert.equal(approveRes.statusCode, 200);

  const branchRes = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Main Branch', code: 'MB1' },
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
    payload: { name: 'River Health Group', type: 'hospital' },
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
  assert.equal(listInitial.json().items.length >= 1, true); // includes HQ

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
