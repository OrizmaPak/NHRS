const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.NODE_ENV = 'development';
process.env.NHRS_CONTEXT_ALLOW_LEGACY = 'true';
const { buildApp } = require('../src/server');
const { resolveTaskforceUnit } = require('../src/routes/taskforce');

function b64(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeToken(payload, secret = 'change-me') {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const d = `${h}.${p}`;
  const s = crypto.createHmac('sha256', secret).update(d).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${d}.${s}`;
}

function getByPath(obj, path) {
  const parts = String(path).split('.');
  let current = obj;
  for (const part of parts) {
    current = current?.[part];
  }
  return current;
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => String(getByPath(doc, k)) === String(v));
}

function makeCollection() {
  const items = [];
  return {
    items,
    createIndex: async () => ({}),
    insertOne: async (doc) => { items.push(structuredClone(doc)); return { acknowledged: true }; },
    findOne: async (filter) => items.find((x) => matches(x, filter)) || null,
    updateOne: async (filter, update) => {
      const idx = items.findIndex((x) => matches(x, filter));
      if (idx >= 0) items[idx] = { ...items[idx], ...(update.$set || {}) };
      return { acknowledged: true };
    },
    find: (filter = {}) => {
      let result = items.filter((x) => matches(x, filter));
      return {
        sort: () => ({ toArray: async () => structuredClone(result) }),
        toArray: async () => structuredClone(result),
      };
    },
    deleteOne: async (filter) => {
      const idx = items.findIndex((x) => matches(x, filter));
      if (idx >= 0) items.splice(idx, 1);
      return { acknowledged: true };
    },
  };
}

function makeDb() {
  const stores = { taskforce_units: makeCollection(), taskforce_members: makeCollection() };
  return { __stores: stores, collection: (name) => stores[name] || makeCollection() };
}

function setup(fetchImpl) {
  const db = makeDb();
  const app = buildApp({ dbReady: true, db, fetchImpl });
  return { app, db };
}

test('routing fallback LGA -> STATE -> REGION -> NATIONAL', async () => {
  const repo = {
    units: () => ({
      findOne: async (filter) => {
        if (filter.level === 'LGA') return null;
        if (filter.level === 'STATE' && filter['coverage.state'] === 'Lagos') return { unitId: 'state-1', level: 'STATE' };
        return null;
      },
    }),
  };
  const res = await resolveTaskforceUnit(repo, { location: { state: 'Lagos', lga: 'Ikeja' } });
  assert.equal(res.unitId, 'state-1');
  assert.equal(res.level, 'STATE');
});

test('internal resolve endpoint returns matched unit', async () => {
  const { app, db } = setup(async (url) => {
    if (String(url).includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  await db.collection('taskforce_units').insertOne({ unitId: 'lga-1', level: 'LGA', name: 'Ikeja Unit', coverage: { state: 'Lagos', lga: 'Ikeja', region: null }, status: 'active' });

  const res = await app.inject({
    method: 'POST',
    url: '/internal/taskforce/resolve',
    headers: { 'x-internal-token': 'change-me-internal-token' },
    payload: { location: { state: 'Lagos', lga: 'Ikeja' } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().unitId, 'lga-1');
});

test('unit and member management endpoints work', async () => {
  const { app } = setup(async (url) => {
    if (String(url).includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const token = makeToken({ sub: 'admin-1' });
  const create = await app.inject({
    method: 'POST',
    url: '/taskforce/units',
    headers: { authorization: `Bearer ${token}` },
    payload: { level: 'STATE', name: 'Lagos State Unit', coverage: { state: 'Lagos' } },
  });
  assert.equal(create.statusCode, 201);
  const unitId = create.json().unit.unitId;

  const addMember = await app.inject({
    method: 'POST',
    url: `/taskforce/units/${unitId}/members`,
    headers: { authorization: `Bearer ${token}` },
    payload: { userId: 'reviewer-1', roles: ['reviewer'] },
  });
  assert.equal(addMember.statusCode, 201);

  const listMembers = await app.inject({ method: 'GET', url: `/taskforce/units/${unitId}/members`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(listMembers.statusCode, 200);
  assert.equal(listMembers.json().items.length, 1);
});
