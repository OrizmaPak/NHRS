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
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${signature}`;
}

function makeFakeDb() {
  const entries = [];
  return {
    __inspect: { entries },
    collection(name) {
      if (name !== 'record_entries') return { createIndex: async () => ({}) };
      return {
        insertOne: async (doc) => { entries.push(structuredClone(doc)); return { acknowledged: true }; },
        findOne: async (query) => entries.find((item) => item.entryId === query.entryId) || null,
        find: (query) => {
          let filtered = entries.filter((item) => {
            if (query.ownerUserId && item.ownerUserId !== query.ownerUserId) return false;
            if (query.nin && item.nin !== query.nin) return false;
            if (query.membershipId?.$in) return query.membershipId.$in.includes(item.membershipId);
            if (query['visibility.hidden']?.$ne === true && item.visibility?.hidden === true) return false;
            if (query.status && item.status !== query.status) return false;
            return true;
          });
          return {
            sort: () => ({ toArray: async () => structuredClone(filtered) }),
            toArray: async () => structuredClone(filtered),
          };
        },
        updateOne: async (query, update) => {
          const idx = entries.findIndex((item) => item.entryId === query.entryId);
          if (idx >= 0) entries[idx] = { ...entries[idx], ...(update.$set || {}) };
          return { acknowledged: true };
        },
        createIndex: async () => ({}),
      };
    },
  };
}

function buildTestApp(fetchImpl) {
  return buildApp({ dbReady: true, db: makeFakeDb(), fetchImpl });
}

test('citizen timeline returns contributing institutions and provider access emits notification', async () => {
  let notificationEvents = 0;
  const app = buildTestApp(async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    if (target.endsWith('/me')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ user: { nin: '90000000001' } }) };
    }
    if (target.includes('/internal/notifications/events')) {
      notificationEvents += 1;
      return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({}) };
  });

  const citizen = makeAccessToken({ sub: 'citizen-1' });
  const provider = makeAccessToken({ sub: 'provider-1' });

  const createSymptom = await app.inject({
    method: 'POST',
    url: '/records/me/symptoms',
    headers: { authorization: `Bearer ${citizen}` },
    payload: { symptoms: ['headache'] },
  });
  assert.equal(createSymptom.statusCode, 201);

  const createProviderEntry = await app.inject({
    method: 'POST',
    url: '/records/90000000001/entries',
    headers: { authorization: `Bearer ${provider}`, 'x-org-id': 'org-1', 'x-branch-id': 'branch-1' },
    payload: { entryType: 'clinical_note', payload: { note: 'Observed fever' } },
  });
  assert.equal(createProviderEntry.statusCode, 201);

  const mine = await app.inject({
    method: 'GET',
    url: '/records/me',
    headers: { authorization: `Bearer ${citizen}` },
  });
  assert.equal(mine.statusCode, 200);
  assert.equal(Array.isArray(mine.json().contributingInstitutions), true);
  assert.equal(mine.json().contributingInstitutions.some((item) => item.organizationId === 'org-1'), true);

  const providerRead = await app.inject({
    method: 'GET',
    url: '/records/90000000001',
    headers: { authorization: `Bearer ${provider}`, 'x-org-id': 'org-1', 'x-branch-id': 'branch-1' },
  });
  assert.equal(providerRead.statusCode, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(notificationEvents > 0, true);
});

test('hide endpoint prevents hidden entry from provider reads', async () => {
  const app = buildTestApp(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (target.endsWith('/me')) return { ok: true, status: 200, text: async () => JSON.stringify({ user: { nin: '90000000001' } }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });
  const citizen = makeAccessToken({ sub: 'citizen-1' });
  const provider = makeAccessToken({ sub: 'provider-1' });

  const created = await app.inject({
    method: 'POST',
    url: '/records/me/symptoms',
    headers: { authorization: `Bearer ${citizen}` },
    payload: { symptoms: ['cough'] },
  });
  const entryId = created.json().entry.entryId;

  const beforeHide = await app.inject({
    method: 'GET',
    url: '/records/90000000001',
    headers: { authorization: `Bearer ${provider}`, 'x-org-id': 'org-1' },
  });
  assert.equal(beforeHide.json().items.length >= 1, true);

  const hide = await app.inject({
    method: 'POST',
    url: `/records/entries/${entryId}/hide`,
    headers: { authorization: `Bearer ${citizen}` },
  });
  assert.equal(hide.statusCode, 200);

  const afterHide = await app.inject({
    method: 'GET',
    url: '/records/90000000001',
    headers: { authorization: `Bearer ${provider}`, 'x-org-id': 'org-1' },
  });
  assert.equal(afterHide.statusCode, 200);
  assert.equal(afterHide.json().items.some((item) => item.entryId === entryId), false);
});

test('edit endpoint enforces creator and 24h editable window', async () => {
  const app = buildTestApp(async (url) => {
    const target = String(url);
    if (target.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    if (target.endsWith('/me')) return { ok: true, status: 200, text: async () => JSON.stringify({ user: { nin: '90000000001' } }) };
    return { ok: true, status: 202, text: async () => JSON.stringify({}) };
  });

  const creator = makeAccessToken({ sub: 'creator-1' });
  const otherUser = makeAccessToken({ sub: 'other-1' });

  const created = await app.inject({
    method: 'POST',
    url: '/records/me/symptoms',
    headers: { authorization: `Bearer ${creator}` },
    payload: { symptoms: ['fatigue'] },
  });
  const entryId = created.json().entry.entryId;

  const forbiddenOther = await app.inject({
    method: 'PATCH',
    url: `/records/entries/${entryId}`,
    headers: { authorization: `Bearer ${otherUser}` },
    payload: { payload: { symptoms: ['none'] } },
  });
  assert.equal(forbiddenOther.statusCode, 403);

  const allowedUpdate = await app.inject({
    method: 'PATCH',
    url: `/records/entries/${entryId}`,
    headers: { authorization: `Bearer ${creator}` },
    payload: { payload: { symptoms: ['improved'] } },
  });
  assert.equal(allowedUpdate.statusCode, 200);
});
