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
  const lab_results = [];
  return {
    __inspect: { lab_results },
    collection(name) {
      if (name !== 'lab_results') return { createIndex: async () => ({}) };
      return {
        createIndex: async () => ({}),
        insertOne: async (d) => { lab_results.push(structuredClone(d)); return { acknowledged: true }; },
        deleteOne: async (q) => { const i = lab_results.findIndex((x) => x.resultId === q.resultId); if (i >= 0) lab_results.splice(i, 1); return { acknowledged: true }; },
        findOne: async (q) => lab_results.find((x) => x.resultId === q.resultId) || null,
        updateOne: async (q, u) => { const i = lab_results.findIndex((x) => x.resultId === q.resultId); if (i >= 0) lab_results[i] = { ...lab_results[i], ...(u.$set || {}) }; return { acknowledged: true }; },
        countDocuments: async (f) => lab_results.filter((x) => x.nin === f.nin).length,
        find: (f) => {
          const items = lab_results.filter((x) => x.nin === f.nin);
          return { sort: () => ({ skip: (n) => ({ limit: (l) => ({ toArray: async () => structuredClone(items.slice(n, n + l)) }) }) }) };
        },
      };
    },
  };
}

function setup(fetchImpl) { const db = makeDb(); return { db, app: buildApp({ dbReady: true, db, fetchImpl }) }; }

test('create lab result registers index and supports read', async () => {
  let indexCalls = 0;
  const { app } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/records/90000000011/entries')) { indexCalls += 1; return { ok: true, status: 201, text: async () => JSON.stringify({}) }; }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const tk = token({ sub: 'lab-user' });
  const create = await app.inject({ method: 'POST', url: '/labs/90000000011/results', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { testName: 'FBC' } });
  assert.equal(create.statusCode, 201);
  assert.equal(indexCalls, 1);

  const read = await app.inject({ method: 'GET', url: '/labs/90000000011/results', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' } });
  assert.equal(read.statusCode, 200);
  assert.equal(Array.isArray(read.json().items), true);
});

test('edit after window returns 403 message', async () => {
  const { app, db } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/records/90000000012/entries')) return { ok: true, status: 201, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const tk = token({ sub: 'lab-edit' });
  const created = await app.inject({ method: 'POST', url: '/labs/90000000012/results', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { testName: 'Urea' } });
  const id = created.json().result.resultId;
  db.__inspect.lab_results[0].editableUntil = new Date(Date.now() - 1_000).toISOString();

  const denied = await app.inject({ method: 'PATCH', url: `/labs/results/id/${id}`, headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { notes: 'late' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().message, 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW');
});

test('missing org header and index failure return consistent errors', async () => {
  const { app } = setup(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/records/90000000013/entries')) return { ok: false, status: 500, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const tk = token({ sub: 'lab-err' });
  const missingHeader = await app.inject({ method: 'GET', url: '/labs/90000000013/results', headers: { authorization: `Bearer ${tk}` } });
  assert.equal(missingHeader.statusCode, 400);

  const idxFail = await app.inject({ method: 'POST', url: '/labs/90000000013/results', headers: { authorization: `Bearer ${tk}`, 'x-org-id': 'org-1' }, payload: { testName: 'CRP' } });
  assert.equal(idxFail.statusCode, 502);
  assert.ok(idxFail.json().message);
});
