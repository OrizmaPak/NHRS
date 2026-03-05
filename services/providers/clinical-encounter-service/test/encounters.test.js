const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildApp } = require('../src/server');
const { buildSignedContext, encodeContext, signEncodedContext } = require('../../../../libs/shared/src/nhrs-context');

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeToken(payload, secret = 'change-me') {
  const h = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = base64Url(JSON.stringify(payload));
  const d = `${h}.${p}`;
  const s = crypto.createHmac('sha256', secret).update(d).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${d}.${s}`;
}

function makeDb() {
  const encounters = [];
  return {
    __inspect: { encounters },
    collection(name) {
      if (name !== 'encounters') return { createIndex: async () => ({}) };
      return {
        createIndex: async () => ({}),
        insertOne: async (doc) => { encounters.push(structuredClone(doc)); return { acknowledged: true }; },
        deleteOne: async (q) => { const i = encounters.findIndex((x) => x.encounterId === q.encounterId); if (i >= 0) encounters.splice(i, 1); return { acknowledged: true }; },
        findOne: async (q) => encounters.find((x) => x.encounterId === q.encounterId) || null,
        updateOne: async (q, u) => { const i = encounters.findIndex((x) => x.encounterId === q.encounterId); if (i >= 0) encounters[i] = { ...encounters[i], ...(u.$set || {}) }; return { acknowledged: true }; },
        countDocuments: async (f) => encounters.filter((x) => x.nin === f.nin).length,
        find: (f) => {
          const items = encounters.filter((x) => x.nin === f.nin);
          return {
            sort: () => ({ skip: (n) => ({ limit: (l) => ({ toArray: async () => structuredClone(items.slice(n, n + l)) }) }) }),
          };
        },
      };
    },
  };
}

function ctx(fetchImpl) {
  const db = makeDb();
  const app = buildApp({ dbReady: true, db, fetchImpl });
  return { app, db };
}

test('create encounter registers index pointer', async () => {
  let indexCalls = 0;
  const { app, db } = ctx(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/doctors/provider-1/status')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'verified' }) };
    if (t.includes('/records/90000000001/entries')) { indexCalls += 1; return { ok: true, status: 201, text: async () => JSON.stringify({}) }; }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const token = makeToken({ sub: 'provider-1' });
  const res = await app.inject({
    method: 'POST',
    url: '/encounters/90000000001',
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1', 'x-branch-id': 'b-1' },
    payload: { visitType: 'outpatient', chiefComplaint: 'Fever' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(indexCalls, 1);
  assert.equal(db.__inspect.encounters.length, 1);
  assert.equal(db.__inspect.encounters[0].pointers?.service, 'clinical-encounter-service');
  assert.equal(db.__inspect.encounters[0].pointers?.resourceId, db.__inspect.encounters[0].encounterId);
});

test('edit within 24h allowed and after 24h denied', async () => {
  const { app, db } = ctx(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/doctors/provider-2/status')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'verified' }) };
    if (t.includes('/records/90000000002/entries')) return { ok: true, status: 201, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const token = makeToken({ sub: 'provider-2' });
  const created = await app.inject({
    method: 'POST',
    url: '/encounters/90000000002',
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1' },
    payload: { visitType: 'inpatient', chiefComplaint: 'Pain' },
  });
  const id = created.json().encounter.encounterId;

  const okEdit = await app.inject({
    method: 'PATCH', url: `/encounters/id/${id}`,
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1' },
    payload: { notes: 'Updated' },
  });
  assert.equal(okEdit.statusCode, 200);

  db.__inspect.encounters[0].editableUntil = new Date(Date.now() - 60_000).toISOString();
  const denied = await app.inject({
    method: 'PATCH', url: `/encounters/id/${id}`,
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1' },
    payload: { notes: 'Late edit' },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().message, 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW');
});

test('missing org header fails on provider routes', async () => {
  const { app } = ctx(async (url) => {
    if (String(url).includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const token = makeToken({ sub: 'provider-3' });
  const res = await app.inject({ method: 'GET', url: '/encounters/90000000003', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 400);
});

test('index registration failure returns 502 and rolls back write', async () => {
  const { app, db } = ctx(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/doctors/provider-4/status')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'verified' }) };
    if (t.includes('/records/90000000004/entries')) return { ok: false, status: 503, text: async () => JSON.stringify({ message: 'down' }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const token = makeToken({ sub: 'provider-4' });
  const res = await app.inject({
    method: 'POST', url: '/encounters/90000000004',
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1' },
    payload: { visitType: 'emergency', chiefComplaint: 'Trauma' },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(db.__inspect.encounters.length, 0);
});

test('creator-only edit is enforced', async () => {
  const { app } = ctx(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/doctors/provider-creator/status')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'verified' }) };
    if (t.includes('/records/90000000005/entries')) return { ok: true, status: 201, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const creator = makeToken({ sub: 'provider-creator' });
  const other = makeToken({ sub: 'provider-other' });
  const created = await app.inject({
    method: 'POST',
    url: '/encounters/90000000005',
    headers: { authorization: `Bearer ${creator}`, 'x-org-id': 'org-1' },
    payload: { visitType: 'outpatient', chiefComplaint: 'Cough' },
  });
  const id = created.json().encounter.encounterId;
  const denied = await app.inject({
    method: 'PATCH',
    url: `/encounters/id/${id}`,
    headers: { authorization: `Bearer ${other}`, 'x-org-id': 'org-1' },
    payload: { notes: 'attempted edit' },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().message, 'Only the creator can edit this record');
});

test('suspended doctor cannot create encounter', async () => {
  const { app } = ctx(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/doctors/provider-suspended/status')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'suspended' }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const token = makeToken({ sub: 'provider-suspended' });
  const res = await app.inject({
    method: 'POST',
    url: '/encounters/90000000006',
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1' },
    payload: { visitType: 'outpatient', chiefComplaint: 'Headache' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().message, 'DOCTOR_LICENSE_NOT_VERIFIED');
});

test('revoked doctor cannot create encounter', async () => {
  const { app } = ctx(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/doctors/provider-revoked/status')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'revoked' }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const token = makeToken({ sub: 'provider-revoked' });
  const res = await app.inject({
    method: 'POST',
    url: '/encounters/90000000007',
    headers: { authorization: `Bearer ${token}`, 'x-org-id': 'org-1' },
    payload: { visitType: 'outpatient', chiefComplaint: 'Fever' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().message, 'DOCTOR_LICENSE_NOT_VERIFIED');
});

test('rejects invalid trusted context signature on protected endpoint', async () => {
  const { app } = ctx(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) }));
  const payload = buildSignedContext({
    requestId: 'req-invalid-ctx',
    userId: 'provider-x',
    roles: ['doctor'],
    orgId: 'org-1',
    branchId: 'b-1',
    permissionsChecked: ['encounters.create'],
    membershipChecked: true,
  });
  const encoded = encodeContext(payload);

  const res = await app.inject({
    method: 'POST',
    url: '/encounters/90000000008',
    headers: {
      authorization: 'Bearer invalid.jwt.token',
      'x-org-id': 'org-1',
      'x-nhrs-context': encoded,
      'x-nhrs-context-signature': 'bad-signature',
    },
    payload: { visitType: 'outpatient', chiefComplaint: 'Headache' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().message, 'INVALID_TRUST_CONTEXT');
});

test('accepts valid trusted context and populates req.auth from context', async () => {
  const { app } = ctx(async (url) => {
    const t = String(url);
    if (t.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (t.includes('/doctors/provider-from-context/status')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'verified' }) };
    }
    if (t.includes('/records/90000000009/entries')) return { ok: true, status: 201, text: async () => JSON.stringify({}) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const payload = buildSignedContext({
    requestId: 'req-valid-ctx',
    userId: 'provider-from-context',
    roles: ['doctor'],
    orgId: 'org-ctx',
    branchId: 'branch-ctx',
    permissionsChecked: ['encounters.create'],
    membershipChecked: true,
  });
  const encoded = encodeContext(payload);
  const signature = signEncodedContext(encoded, process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret');

  const res = await app.inject({
    method: 'POST',
    url: '/encounters/90000000009',
    headers: {
      authorization: 'Bearer malformed.token.payload',
      'x-org-id': 'org-ctx',
      'x-branch-id': 'branch-ctx',
      'x-nhrs-context': encoded,
      'x-nhrs-context-signature': signature,
    },
    payload: { visitType: 'outpatient', chiefComplaint: 'Chest pain' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().encounter.providerUserId, 'provider-from-context');
  assert.equal(res.json().encounter.organizationId, 'org-ctx');
});
