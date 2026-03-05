const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildApp } = require('../src/server');
const { resolveScopeTargets } = require('../src/routes/requests');

function b64(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeToken(payload, secret = 'change-me') {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

function getByPath(obj, path) {
  const parts = String(path).split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function matchesFilter(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = getByPath(doc, key);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(value, '$in')) {
        return value.$in.map(String).includes(String(actual));
      }
      return false;
    }
    return String(actual) === String(value);
  });
}

function createCollectionStore() {
  const items = [];
  return {
    items,
    createIndex: async () => ({}),
    insertOne: async (doc) => {
      items.push(structuredClone(doc));
      return { acknowledged: true };
    },
    findOne: async (filter) => items.find((x) => matchesFilter(x, filter)) || null,
    updateOne: async (filter, update, options = {}) => {
      const idx = items.findIndex((x) => matchesFilter(x, filter));
      if (idx >= 0) {
        items[idx] = { ...items[idx], ...(update.$set || {}) };
      } else if (options.upsert) {
        items.push({ ...(filter || {}), ...(update.$set || {}) });
      }
      return { acknowledged: true };
    },
    countDocuments: async (filter = {}) => items.filter((x) => matchesFilter(x, filter)).length,
    find: (filter = {}) => {
      let result = items.filter((x) => matchesFilter(x, filter));
      return {
        sort: (sortSpec = {}) => {
          const [sortKey, sortDir] = Object.entries(sortSpec)[0] || ['createdAt', 1];
          result = result.slice().sort((a, b) => {
            const av = getByPath(a, sortKey);
            const bv = getByPath(b, sortKey);
            const ad = av ? new Date(av).getTime() : 0;
            const bd = bv ? new Date(bv).getTime() : 0;
            return sortDir >= 0 ? ad - bd : bd - ad;
          });
          return {
            skip: (n) => ({
              limit: (l) => ({
                toArray: async () => structuredClone(result.slice(n, n + l)),
              }),
            }),
            limit: (l) => ({ toArray: async () => structuredClone(result.slice(0, l)) }),
            toArray: async () => structuredClone(result),
          };
        },
        skip: (n) => ({ limit: (l) => ({ toArray: async () => structuredClone(result.slice(n, n + l)) }) }),
        limit: (l) => ({ toArray: async () => structuredClone(result.slice(0, l)) }),
        toArray: async () => structuredClone(result),
      };
    },
  };
}

function makeDb() {
  const stores = {
    emergency_requests: createCollectionStore(),
    emergency_responses: createCollectionStore(),
    emergency_rooms: createCollectionStore(),
    emergency_room_messages: createCollectionStore(),
    provider_inventory: createCollectionStore(),
  };
  return {
    __stores: stores,
    collection(name) {
      if (!stores[name]) {
        stores[name] = createCollectionStore();
      }
      return stores[name];
    },
  };
}

function makeContext(fetchImpl) {
  const db = makeDb();
  const app = buildApp({ dbReady: true, db, fetchImpl });
  return { app, db };
}

test('request creation creates request and incident room', async () => {
  const notifications = [];
  const { app, db } = makeContext(async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.includes('/internal/notifications/events')) {
      notifications.push(JSON.parse(options.body));
      return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  await db.collection('provider_inventory').insertOne({
    inventoryId: 'inv-1',
    providerOrgId: 'org-a',
    providerBranchId: 'branch-a',
    location: { state: 'Lagos', lga: 'Ikeja', region: 'SOUTH_WEST' },
    items: [{ itemType: 'drug', name: 'Oxygen', quantityStatus: 'in_stock' }],
    updatedAt: new Date(),
  });

  const token = makeToken({ sub: 'citizen-1', roles: ['citizen'] });
  const res = await app.inject({
    method: 'POST',
    url: '/emergency/requests',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: 'Need urgent blood',
      description: 'A+ blood urgently needed',
      category: 'blood',
      urgency: 'critical',
      scope: { level: 'LGA', state: 'Lagos', lga: 'Ikeja' },
      location: { state: 'Lagos', lga: 'Ikeja' },
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(db.__stores.emergency_requests.items.length, 1);
  assert.equal(db.__stores.emergency_rooms.items.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(notifications.length > 0, true);
  assert.equal(notifications[0].eventType, 'EMERGENCY_ALERT');
});

test('scope routing resolves LGA/STATE/REGION/NATIONAL targets', async () => {
  const inventoryStore = createCollectionStore();
  await inventoryStore.insertOne({ providerOrgId: 'org-lga', providerBranchId: 'b1', location: { state: 'Lagos', lga: 'Ikeja', region: 'SOUTH_WEST' } });
  await inventoryStore.insertOne({ providerOrgId: 'org-state', providerBranchId: 'b2', location: { state: 'Lagos', lga: 'Epe', region: 'SOUTH_WEST' } });
  await inventoryStore.insertOne({ providerOrgId: 'org-region', providerBranchId: 'b3', location: { state: 'Oyo', lga: 'Ibadan', region: 'SOUTH_WEST' } });
  await inventoryStore.insertOne({ providerOrgId: 'org-national', providerBranchId: 'b4', location: { state: 'Kano', lga: 'Nassarawa', region: 'NORTH_WEST' } });

  const repo = { inventory: () => inventoryStore };

  const lgaTargets = await resolveScopeTargets(repo, { level: 'LGA', state: 'Lagos', lga: 'Ikeja' }, {});
  assert.equal(lgaTargets.some((x) => x.providerOrgId === 'org-lga'), true);
  assert.equal(lgaTargets.some((x) => x.providerOrgId === 'org-state'), false);

  const stateTargets = await resolveScopeTargets(repo, { level: 'STATE', state: 'Lagos' }, {});
  assert.equal(stateTargets.some((x) => x.providerOrgId === 'org-lga'), true);
  assert.equal(stateTargets.some((x) => x.providerOrgId === 'org-state'), true);

  const regionTargets = await resolveScopeTargets(repo, { level: 'REGION', region: 'SOUTH_WEST' }, {});
  assert.equal(regionTargets.some((x) => x.providerOrgId === 'org-region'), true);
  assert.equal(regionTargets.some((x) => x.providerOrgId === 'org-national'), false);

  const nationalTargets = await resolveScopeTargets(repo, { level: 'NATIONAL' }, {});
  assert.equal(nationalTargets.length, 4);
});

test('provider response create and list works', async () => {
  const { app } = makeContext(async (url) => {
    if (String(url).includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const citizenToken = makeToken({ sub: 'citizen-x' });
  const createReq = await app.inject({
    method: 'POST',
    url: '/emergency/requests',
    headers: { authorization: `Bearer ${citizenToken}` },
    payload: {
      title: 'Ambulance needed',
      description: 'Immediate transfer required',
      category: 'ambulance',
      urgency: 'high',
      scope: { level: 'STATE', state: 'Lagos' },
      location: { state: 'Lagos', lga: 'Eti-Osa' },
    },
  });
  const requestId = createReq.json().request.requestId;

  const providerToken = makeToken({ sub: 'provider-1', roles: ['org_staff'] });
  const createRes = await app.inject({
    method: 'POST',
    url: `/emergency/requests/${requestId}/responses`,
    headers: { authorization: `Bearer ${providerToken}`, 'x-org-id': 'org-1', 'x-branch-id': 'branch-1' },
    payload: { responseType: 'available', availability: true, etaMinutes: 25 },
  });
  assert.equal(createRes.statusCode, 201);

  const list = await app.inject({
    method: 'GET',
    url: `/emergency/requests/${requestId}/responses`,
    headers: { authorization: `Bearer ${providerToken}` },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items.length, 1);
});

test('incident room messages persist and pagination works', async () => {
  const { app } = makeContext(async (url) => {
    if (String(url).includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const token = makeToken({ sub: 'user-room' });
  const created = await app.inject({
    method: 'POST',
    url: '/emergency/requests',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: 'Need oxygen',
      description: 'Patient needs oxygen support',
      category: 'drug',
      urgency: 'medium',
      scope: { level: 'STATE', state: 'Lagos' },
      location: { state: 'Lagos', lga: 'Ikeja' },
    },
  });
  const roomId = created.json().room.roomId;

  await app.inject({ method: 'POST', url: `/emergency/rooms/${roomId}/messages`, headers: { authorization: `Bearer ${token}` }, payload: { body: 'First update' } });
  await app.inject({ method: 'POST', url: `/emergency/rooms/${roomId}/messages`, headers: { authorization: `Bearer ${token}` }, payload: { body: 'Second update' } });

  const page1 = await app.inject({ method: 'GET', url: `/emergency/rooms/${roomId}/messages?page=1&limit=1`, headers: { authorization: `Bearer ${token}` } });
  const page2 = await app.inject({ method: 'GET', url: `/emergency/rooms/${roomId}/messages?page=2&limit=1`, headers: { authorization: `Bearer ${token}` } });

  assert.equal(page1.statusCode, 200);
  assert.equal(page2.statusCode, 200);
  assert.equal(page1.json().items.length, 1);
  assert.equal(page2.json().items.length, 1);
  assert.notEqual(page1.json().items[0].messageId, page2.json().items[0].messageId);
});

test('permission checks: missing auth is 401 and missing x-org-id on provider routes is 400', async () => {
  const { app } = makeContext(async (url) => {
    if (String(url).includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const unauth = await app.inject({ method: 'GET', url: '/emergency/requests' });
  assert.equal(unauth.statusCode, 401);

  const token = makeToken({ sub: 'provider-z' });
  const createReq = await app.inject({
    method: 'POST',
    url: '/emergency/requests',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: 'Need test kit',
      description: 'Need diagnostics',
      category: 'test',
      urgency: 'high',
      scope: { level: 'STATE', state: 'Lagos' },
      location: { state: 'Lagos', lga: 'Ikeja' },
    },
  });
  const requestId = createReq.json().request.requestId;

  const missingOrg = await app.inject({
    method: 'POST',
    url: `/emergency/requests/${requestId}/responses`,
    headers: { authorization: `Bearer ${token}` },
    payload: { responseType: 'available', availability: true },
  });
  assert.equal(missingOrg.statusCode, 400);
});
