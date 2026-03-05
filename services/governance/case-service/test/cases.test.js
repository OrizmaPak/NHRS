const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.NODE_ENV = 'test';
process.env.NHRS_CONTEXT_ALLOW_LEGACY = 'true';
const { buildApp } = require('../src/server');

function b64(input) { return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
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
  for (const part of parts) current = current?.[part];
  return current;
}

function setByPath(obj, path, value) {
  const parts = String(path).split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (current[key] == null || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => {
    const actual = getByPath(doc, k);
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '$in')) {
      return v.$in.map(String).includes(String(actual));
    }
    return String(actual) === String(v);
  });
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
      if (idx >= 0) {
        const next = { ...items[idx] };
        for (const [key, value] of Object.entries(update.$set || {})) {
          setByPath(next, key, value);
        }
        items[idx] = next;
      }
      return { acknowledged: true };
    },
    countDocuments: async (filter = {}) => items.filter((x) => matches(x, filter)).length,
    find: (filter = {}) => {
      let result = items.filter((x) => matches(x, filter));
      return {
        sort: (spec = {}) => {
          const [key, dir] = Object.entries(spec)[0] || ['createdAt', -1];
          result = result.slice().sort((a, b) => {
            const av = getByPath(a, key); const bv = getByPath(b, key);
            const ad = av ? new Date(av).getTime() : 0; const bd = bv ? new Date(bv).getTime() : 0;
            return dir >= 0 ? ad - bd : bd - ad;
          });
          return {
            skip: (n) => ({ limit: (l) => ({ toArray: async () => structuredClone(result.slice(n, n + l)) }) }),
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
    governance_cases: makeCollection(),
    case_actions: makeCollection(),
    case_rooms: makeCollection(),
    case_room_messages: makeCollection(),
  };
  return {
    __stores: stores,
    collection: (name) => {
      if (!stores[name]) {
        stores[name] = makeCollection();
      }
      return stores[name];
    },
  };
}

function setup(fetchImpl) {
  const db = makeDb();
  const app = buildApp({ dbReady: true, db, fetchImpl });
  return { app, db };
}

test('case creation auto-routes by location and creates room, notifies assigned unit', async () => {
  let notifications = 0;
  const { app, db } = setup(async (url, options = {}) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/internal/taskforce/resolve')) return { ok: true, status: 200, text: async () => JSON.stringify({ unitId: 'lga-1', level: 'LGA' }) };
    if (t.includes('/internal/taskforce/units/lga-1/members')) return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ userId: 'reviewer-1', roles: ['reviewer'], status: 'active' }] }) };
    if (t.includes('/internal/notifications/events')) { notifications += 1; return { ok: true, status: 202, text: async () => '{}' }; }
    return { ok: true, status: 202, text: async () => '{}' };
  });

  const token = makeToken({ sub: 'citizen-1' });
  const res = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      caseType: 'CITIZEN_COMPLAINT',
      subject: 'Wrong dosage entered',
      description: 'My medication history has an error',
      nin: '90000000001',
      location: { state: 'Lagos', lga: 'Ikeja' },
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(db.__stores.governance_cases.items.length, 1);
  assert.equal(db.__stores.case_rooms.items.length, 1);
  await app.flushOutboxOnce();
  assert.equal(notifications > 0, true);
  assert.equal(db.__stores.governance_cases.items[0].routing.assignedUnitId, 'lga-1');
});

test('propose correction moves case to awaiting_approval', async () => {
  const { app, db } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/internal/taskforce/units/lga-1/members')) return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ userId: 'reviewer-1', roles: ['reviewer'], status: 'active' }] }) };
    return { ok: true, status: 202, text: async () => '{}' };
  });

  await db.collection('governance_cases').insertOne({
    caseId: 'case-1',
    caseType: 'RECORD_CORRECTION',
    createdByUserId: 'citizen-1',
    createdByType: 'citizen',
    nin: '90000000001',
    related: { recordEntryId: 'entry-1', pointers: null },
    subject: 'Correction',
    description: 'Fix needed',
    location: { state: 'Lagos', lga: 'Ikeja', region: null },
    routing: { assignedUnitId: 'lga-1', assignedLevel: 'LGA', escalationCount: 0 },
    status: 'in_review',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection('case_rooms').insertOne({ roomId: 'room-1', caseId: 'case-1', participants: [], createdAt: new Date(), updatedAt: new Date() });

  const token = makeToken({ sub: 'reviewer-1' });
  const res = await app.inject({
    method: 'POST',
    url: '/cases/case-1/corrections/propose',
    headers: { authorization: `Bearer ${token}` },
    payload: { proposedChanges: { field: 'value' }, reason: 'Evidence attached' },
  });

  assert.equal(res.statusCode, 200);
  const updated = db.__stores.governance_cases.items.find((x) => x.caseId === 'case-1');
  assert.equal(updated.status, 'awaiting_approval');
});

test('approve correction requires approver role and triggers index amendment call', async () => {
  let indexCalls = 0;
  const { app, db } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/internal/taskforce/units/state-1/members')) return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ userId: 'approver-1', roles: ['approver'], status: 'active' }] }) };
    if (t.includes('/internal/taskforce/units/state-1') && !t.includes('/members')) return { ok: true, status: 200, text: async () => JSON.stringify({ unit: { unitId: 'state-1', level: 'STATE' } }) };
    if (t.includes('/records/90000000001/entries')) { indexCalls += 1; return { ok: true, status: 201, text: async () => '{}' }; }
    return { ok: true, status: 202, text: async () => '{}' };
  });

  await db.collection('governance_cases').insertOne({
    caseId: 'case-2', caseType: 'RECORD_CORRECTION', createdByUserId: 'provider-1', createdByType: 'provider',
    nin: '90000000001', related: { recordEntryId: 'e-1', pointers: null }, subject: 'Correction', description: 'need update',
    location: { state: 'Lagos', lga: 'Ikeja', region: null }, routing: { assignedUnitId: 'state-1', assignedLevel: 'STATE', escalationCount: 0 },
    status: 'awaiting_approval', createdAt: new Date(), updatedAt: new Date(),
  });
  await db.collection('case_rooms').insertOne({ roomId: 'room-2', caseId: 'case-2', participants: [], createdAt: new Date(), updatedAt: new Date() });

  const unauthorized = await app.inject({
    method: 'POST',
    url: '/cases/case-2/corrections/approve',
    headers: { authorization: `Bearer ${makeToken({ sub: 'not-approver' })}` },
    payload: { decisionNotes: 'ok' },
  });
  assert.equal(unauthorized.statusCode, 403);

  const ok = await app.inject({
    method: 'POST',
    url: '/cases/case-2/corrections/approve',
    headers: { authorization: `Bearer ${makeToken({ sub: 'approver-1' })}`, 'x-org-id': 'gov-unit' },
    payload: { decisionNotes: 'approved after review' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(indexCalls, 1);
});

test('escalation reassigns higher unit and adds participants, logs action', async () => {
  const { app, db } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/internal/taskforce/resolve')) return { ok: true, status: 200, text: async () => JSON.stringify({ unitId: 'state-99', level: 'STATE' }) };
    if (t.includes('/internal/taskforce/units/state-99/members')) return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ userId: 'state-reviewer', roles: ['reviewer'], status: 'active' }] }) };
    return { ok: true, status: 202, text: async () => '{}' };
  });

  await db.collection('governance_cases').insertOne({
    caseId: 'case-3', caseType: 'CITIZEN_COMPLAINT', createdByUserId: 'citizen-2', createdByType: 'citizen', nin: null,
    related: { recordEntryId: null, pointers: null }, subject: 'Escalate', description: 'needs escalation',
    location: { state: 'Lagos', lga: 'Ikeja', region: null }, routing: { assignedUnitId: 'lga-1', assignedLevel: 'LGA', escalationCount: 0 },
    status: 'in_review', createdAt: new Date(), updatedAt: new Date(),
  });
  await db.collection('case_rooms').insertOne({
    roomId: 'room-3', caseId: 'case-3', participants: [{ userId: 'citizen-2', unitId: null, role: 'citizen' }], createdAt: new Date(), updatedAt: new Date(),
  });

  const token = makeToken({ sub: 'dispatcher-1' });
  const res = await app.inject({ method: 'POST', url: '/cases/case-3/escalate', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);

  const updatedCase = db.__stores.governance_cases.items.find((x) => x.caseId === 'case-3');
  assert.equal(updatedCase.routing.assignedUnitId, 'state-99');
  assert.equal(updatedCase.routing.assignedLevel, 'STATE');

  const room = db.__stores.case_rooms.items.find((x) => x.caseId === 'case-3');
  assert.equal(room.participants.some((p) => p.userId === 'state-reviewer'), true);
  const escalatedAction = db.__stores.case_actions.items.find((x) => x.caseId === 'case-3' && x.actionType === 'ESCALATED');
  assert.equal(Boolean(escalatedAction), true);
});

test('missing trusted context is rejected on protected governance routes when legacy fallback disabled', async () => {
  process.env.NHRS_CONTEXT_ALLOW_LEGACY = 'false';
  const { app } = setup(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) }));
  const token = makeToken({ sub: 'user-ctx' });
  const res = await app.inject({
    method: 'POST',
    url: '/cases',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      caseType: 'CITIZEN_COMPLAINT',
      subject: 'Need support',
      description: 'Missing context test',
    },
  });
  assert.ok([401, 403].includes(res.statusCode));
  process.env.NHRS_CONTEXT_ALLOW_LEGACY = 'true';
});
