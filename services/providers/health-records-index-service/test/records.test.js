const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildApp } = require('../src/server');

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

function makeFakeDb() {
  const recordsIndex = [];
  const recordEntries = [];
  const outboxEvents = [];

  return {
    __inspect: { recordsIndex, recordEntries, outboxEvents },
    collection(name) {
      if (name === 'records_index') {
        return {
          createIndex: async () => ({}),
          insertOne: async (doc) => {
            recordsIndex.push(structuredClone(doc));
            return { acknowledged: true };
          },
          findOne: async (query) => recordsIndex.find((item) => {
            if (query.recordId) return item.recordId === query.recordId;
            if (query.citizenUserId) return item.citizenUserId === query.citizenUserId;
            if (query.citizenNin) return item.citizenNin === query.citizenNin;
            return false;
          }) || null,
          updateOne: async (query, update) => {
            const idx = recordsIndex.findIndex((item) => item.recordId === query.recordId);
            if (idx >= 0) recordsIndex[idx] = { ...recordsIndex[idx], ...(update.$set || {}) };
            return { acknowledged: true };
          },
        };
      }

      if (name === 'record_entries') {
        return {
          createIndex: async () => ({}),
          insertOne: async (doc) => {
            recordEntries.push(structuredClone(doc));
            return { acknowledged: true };
          },
          findOne: async (query) => recordEntries.find((item) => item.entryId === query.entryId) || null,
          updateOne: async (query, update) => {
            const idx = recordEntries.findIndex((item) => item.entryId === query.entryId);
            if (idx >= 0) recordEntries[idx] = { ...recordEntries[idx], ...(update.$set || {}) };
            return { acknowledged: true };
          },
          find: (query) => {
            let filtered = recordEntries.filter((item) => (!query.recordId || item.recordId === query.recordId));
            return {
              sort: () => ({
                toArray: async () => structuredClone(filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))),
              }),
            };
          },
        };
      }

      if (name === 'outbox_events') {
        return {
          createIndex: async () => ({}),
          insertOne: async (doc) => {
            outboxEvents.push(structuredClone(doc));
            return { acknowledged: true };
          },
          findOneAndUpdate: async (_filter, update) => {
            const nowTs = Date.now();
            const idx = outboxEvents.findIndex((item) => {
              const status = String(item.status || 'pending');
              if (!['pending', 'failed'].includes(status)) return false;
              const lockTs = item.lockedUntil ? new Date(item.lockedUntil).getTime() : null;
              if (lockTs && lockTs > nowTs) return false;
              return true;
            });
            if (idx < 0) return null;
            const next = { ...outboxEvents[idx] };
            if (update?.$set) {
              Object.assign(next, update.$set);
            }
            if (update?.$inc) {
              for (const [k, v] of Object.entries(update.$inc)) {
                next[k] = Number(next[k] || 0) + Number(v || 0);
              }
            }
            outboxEvents[idx] = next;
            return structuredClone(next);
          },
          updateOne: async (query, update) => {
            const idx = outboxEvents.findIndex((item) => item._id === query._id);
            if (idx >= 0 && update?.$set) {
              outboxEvents[idx] = { ...outboxEvents[idx], ...update.$set };
            }
            return { acknowledged: true };
          },
        };
      }

      return { createIndex: async () => ({}) };
    },
  };
}

function buildTestContext(fetchImpl) {
  const db = makeFakeDb();
  const app = buildApp({ dbReady: true, db, fetchImpl });
  return { app, db };
}

test('citizen can create symptom entry and later edit it', async () => {
  const { app } = buildTestContext(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (target.endsWith('/me')) return { ok: true, status: 200, text: async () => JSON.stringify({ user: { nin: '90000000001' } }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const citizenToken = makeAccessToken({ sub: 'citizen-1', roles: ['citizen'] });
  const createRes = await app.inject({
    method: 'POST',
    url: '/records/me/symptoms',
    headers: { authorization: `Bearer ${citizenToken}` },
    payload: { symptoms: ['headache'], note: 'started yesterday' },
  });
  assert.equal(createRes.statusCode, 201);
  const entryId = createRes.json().entry.entryId;

  const editRes = await app.inject({
    method: 'PATCH',
    url: `/records/entries/${entryId}`,
    headers: { authorization: `Bearer ${citizenToken}` },
    payload: { payload: { symptoms: ['headache', 'fever'], note: 'worse today' } },
  });
  assert.equal(editRes.statusCode, 200);
  assert.deepEqual(editRes.json().entry.payload.symptoms, ['headache', 'fever']);
});

test('provider can create and edit own entry within 24h', async () => {
  const { app } = buildTestContext(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const providerToken = makeAccessToken({ sub: 'provider-1', roles: ['doctor'] });
  const createRes = await app.inject({
    method: 'POST',
    url: '/records/90000000001/entries',
    headers: {
      authorization: `Bearer ${providerToken}`,
      'x-org-id': 'org-1',
      'x-branch-id': 'branch-1',
    },
    payload: { entryType: 'encounter', payload: { summary: 'Checked vitals' } },
  });
  assert.equal(createRes.statusCode, 201);
  const entryId = createRes.json().entry.entryId;

  const editRes = await app.inject({
    method: 'PATCH',
    url: `/records/entries/${entryId}`,
    headers: { authorization: `Bearer ${providerToken}` },
    payload: { payload: { summary: 'Checked vitals and temperature' } },
  });
  assert.equal(editRes.statusCode, 200);
});

test('provider cannot edit after editableUntil expires', async () => {
  const { app, db } = buildTestContext(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const providerToken = makeAccessToken({ sub: 'provider-2', roles: ['doctor'] });
  const createRes = await app.inject({
    method: 'POST',
    url: '/records/90000000002/entries',
    headers: {
      authorization: `Bearer ${providerToken}`,
      'x-org-id': 'org-1',
      'x-branch-id': 'branch-2',
    },
    payload: { entryType: 'note', payload: { text: 'Initial note' } },
  });
  const entryId = createRes.json().entry.entryId;
  const stored = db.__inspect.recordEntries.find((item) => item.entryId === entryId);
  stored.editableUntil = new Date(Date.now() - 60_000).toISOString();

  const editRes = await app.inject({
    method: 'PATCH',
    url: `/records/entries/${entryId}`,
    headers: { authorization: `Bearer ${providerToken}` },
    payload: { payload: { text: 'Late update' } },
  });
  assert.equal(editRes.statusCode, 403);
  assert.equal(editRes.json().message, 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW');
});

test('provider view triggers RECORD_ACCESSED notification event', async () => {
  let notificationCount = 0;
  const { app } = buildTestContext(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (target.includes('/internal/notifications/events')) {
      notificationCount += 1;
      return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const providerToken = makeAccessToken({ sub: 'provider-3', roles: ['doctor'] });
  await app.inject({
    method: 'POST',
    url: '/records/90000000003/entries',
    headers: { authorization: `Bearer ${providerToken}`, 'x-org-id': 'org-1' },
    payload: { entryType: 'encounter', payload: { summary: 'visit' } },
  });

  const readRes = await app.inject({
    method: 'GET',
    url: '/records/90000000003',
    headers: { authorization: `Bearer ${providerToken}`, 'x-org-id': 'org-1', 'x-branch-id': 'branch-x' },
  });
  assert.equal(readRes.statusCode, 200);
  await app.flushOutboxOnce();
  assert.equal(notificationCount > 0, true);
});

test('hidden entries do not show for orgs/roles they are hidden from', async () => {
  const { app } = buildTestContext(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (target.endsWith('/me')) return { ok: true, status: 200, text: async () => JSON.stringify({ user: { nin: '90000000004' } }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const citizenToken = makeAccessToken({ sub: 'citizen-4', roles: ['citizen'] });
  const providerToken = makeAccessToken({ sub: 'provider-4', roles: ['doctor', 'auditor'] });

  const createRes = await app.inject({
    method: 'POST',
    url: '/records/me/symptoms',
    headers: { authorization: `Bearer ${citizenToken}` },
    payload: { symptoms: ['cough'] },
  });
  const entryId = createRes.json().entry.entryId;

  await app.inject({
    method: 'POST',
    url: `/records/entries/${entryId}/hide`,
    headers: { authorization: `Bearer ${citizenToken}` },
    payload: { hidden: true, hiddenFromOrgs: ['org-hidden'], hiddenFromRoles: ['auditor'] },
  });

  const hiddenForOrg = await app.inject({
    method: 'GET',
    url: '/records/90000000004',
    headers: { authorization: `Bearer ${providerToken}`, 'x-org-id': 'org-hidden' },
  });
  assert.equal(hiddenForOrg.statusCode, 200);
  assert.equal(hiddenForOrg.json().entries.some((item) => item.entryId === entryId), false);

  const hiddenForRole = await app.inject({
    method: 'GET',
    url: '/records/90000000004',
    headers: { authorization: `Bearer ${providerToken}`, 'x-org-id': 'org-visible' },
  });
  assert.equal(hiddenForRole.statusCode, 200);
  assert.equal(hiddenForRole.json().entries.some((item) => item.entryId === entryId), false);
});

test('contributingInstitutions list contains only institutions that contributed entries', async () => {
  const { app } = buildTestContext(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (target.endsWith('/me')) return { ok: true, status: 200, text: async () => JSON.stringify({ user: { nin: '90000000005' } }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const citizenToken = makeAccessToken({ sub: 'citizen-5', roles: ['citizen'] });
  const providerToken = makeAccessToken({ sub: 'provider-5', roles: ['doctor'] });

  await app.inject({
    method: 'POST',
    url: '/records/me/symptoms',
    headers: { authorization: `Bearer ${citizenToken}` },
    payload: { symptoms: ['nausea'] },
  });
  await app.inject({
    method: 'POST',
    url: '/records/90000000005/entries',
    headers: { authorization: `Bearer ${providerToken}`, 'x-org-id': 'org-a', 'x-branch-id': 'b-a' },
    payload: { entryType: 'lab_result', payload: { test: 'CBC' } },
  });
  await app.inject({
    method: 'POST',
    url: '/records/90000000005/entries',
    headers: { authorization: `Bearer ${providerToken}`, 'x-org-id': 'org-b', 'x-branch-id': 'b-b' },
    payload: { entryType: 'pharmacy_dispense', payload: { drug: 'Paracetamol' } },
  });

  const meRes = await app.inject({
    method: 'GET',
    url: '/records/me',
    headers: { authorization: `Bearer ${citizenToken}` },
  });
  assert.equal(meRes.statusCode, 200);
  const orgIds = (meRes.json().contributingInstitutions || []).map((item) => item.organizationId).sort();
  assert.deepEqual(orgIds, ['org-a', 'org-b']);
});
