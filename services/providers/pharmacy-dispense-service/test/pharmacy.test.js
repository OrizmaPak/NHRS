const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildApp } = require('../src/server');

function b64(s) { return Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function token(payload, secret = 'change-me') {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const d = `${h}.${p}`;
  const s = crypto.createHmac('sha256', secret).update(d).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${d}.${s}`;
}

function makeDb() {
  const pharmacy_dispenses = [];
  return {
    __inspect: { pharmacy_dispenses },
    collection(name) {
      if (name !== 'pharmacy_dispenses') return { createIndex: async () => ({}) };
      return {
        createIndex: async () => ({}),
        insertOne: async (d) => { pharmacy_dispenses.push(structuredClone(d)); return { acknowledged: true }; },
        deleteOne: async (q) => { const i = pharmacy_dispenses.findIndex((x) => x.dispenseId === q.dispenseId); if (i >= 0) pharmacy_dispenses.splice(i, 1); return { acknowledged: true }; },
        findOne: async (q) => pharmacy_dispenses.find((x) => x.dispenseId === q.dispenseId) || null,
        updateOne: async (q, u) => { const i = pharmacy_dispenses.findIndex((x) => x.dispenseId === q.dispenseId); if (i >= 0) pharmacy_dispenses[i] = { ...pharmacy_dispenses[i], ...(u.$set || {}) }; return { acknowledged: true }; },
        countDocuments: async (f) => pharmacy_dispenses.filter((x) => x.nin === f.nin).length,
        find: (f) => {
          const items = pharmacy_dispenses.filter((x) => x.nin === f.nin);
          return { sort: () => ({ skip: (n) => ({ limit: (l) => ({ toArray: async () => structuredClone(items.slice(n, n + l)) }) }) }) };
        },
      };
    },
  };
}

function setup(fetchImpl) { const db = makeDb(); return { db, app: buildApp({ dbReady: true, db, fetchImpl }) }; }

test('create dispense registers index and read works', async () => {
  let indexCalls = 0;
  const { app } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/records/90000000111/entries')) { indexCalls += 1; return { ok: true, status: 201, text: async () => JSON.stringify({}) }; }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const tk = token({ sub: 'pharm-user' });
  const create = await app.inject({ method: 'POST', url: '/pharmacy/90000000111/dispenses', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { items: [{ drugName: 'Paracetamol' }] } });
  assert.equal(create.statusCode, 201);
  assert.equal(indexCalls, 1);
  assert.equal(create.json().dispense.pointers?.service, 'pharmacy-dispense-service');
  assert.equal(create.json().dispense.pointers?.resourceId, create.json().dispense.dispenseId);

  const read = await app.inject({ method: 'GET', url: '/pharmacy/90000000111/dispenses', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' } });
  assert.equal(read.statusCode, 200);
});

test('edit after window denied with required message', async () => {
  const { app, db } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/records/90000000112/entries')) return { ok: true, status: 201, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const tk = token({ sub: 'pharm-edit' });
  const created = await app.inject({ method: 'POST', url: '/pharmacy/90000000112/dispenses', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { items: [{ drugName: 'Ibuprofen' }] } });
  const id = created.json().dispense.dispenseId;
  db.__inspect.pharmacy_dispenses[0].editableUntil = new Date(Date.now() - 1_000).toISOString();

  const denied = await app.inject({ method: 'PATCH', url: `/pharmacy/dispenses/id/${id}`, headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { notes: 'late' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().message, 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW');
});

test('missing org header and index failure errors are consistent', async () => {
  const { app } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/records/90000000113/entries')) return { ok: false, status: 500, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const tk = token({ sub: 'pharm-err' });

  const miss = await app.inject({ method: 'GET', url: '/pharmacy/90000000113/dispenses', headers: { authorization: `Bearer ${tk}` } });
  assert.equal(miss.statusCode, 400);

  const idxFail = await app.inject({ method: 'POST', url: '/pharmacy/90000000113/dispenses', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { items: [] } });
  assert.equal(idxFail.statusCode, 502);
  assert.ok(idxFail.json().message);
});

test('creator-only edit is enforced for dispenses', async () => {
  const { app } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/records/90000000114/entries')) return { ok: true, status: 201, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const creator = token({ sub: 'pharm-owner' });
  const other = token({ sub: 'pharm-other' });
  const created = await app.inject({ method: 'POST', url: '/pharmacy/90000000114/dispenses', headers: { authorization: `Bearer ${creator}`, 'x-org-id': 'org-1' }, payload: { items: [{ drugName: 'Azithromycin' }] } });
  const dispenseId = created.json().dispense.dispenseId;
  const denied = await app.inject({ method: 'PATCH', url: `/pharmacy/dispenses/id/${dispenseId}`, headers: { authorization: `Bearer ${other}`, 'x-org-id': 'org-1' }, payload: { notes: 'tamper' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().message, 'Only the creator can edit this record');
});
