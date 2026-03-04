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
  const memberships = [];
  const assignments = [];
  const events = [];

  return {
    collection(name) {
      if (name === 'org_memberships') {
        return {
          insertOne: async (doc) => { memberships.push(structuredClone(doc)); return { acknowledged: true }; },
          findOne: async (query) => memberships.find((m) => {
            if (query.membershipId) return m.membershipId === query.membershipId && m.organizationId === query.organizationId;
            if (query.organizationId && query.nin) return m.organizationId === query.organizationId && m.nin === query.nin;
            if (query.nin && query.userId === null) return m.nin === query.nin && m.userId === null;
            if (query.organizationId && query.userId) return m.organizationId === query.organizationId && m.userId === query.userId;
            return false;
          }) || null,
          find: (query) => ({
            toArray: async () => structuredClone(memberships.filter((m) => {
              if (query.userId) return m.userId === query.userId;
              if (query.nin && query.userId === null) return m.nin === query.nin && m.userId === null;
              if (query.organizationId && query.membershipId) return m.organizationId === query.organizationId && m.membershipId === query.membershipId;
              if (query.organizationId) return m.organizationId === query.organizationId;
              return true;
            })),
            skip: () => ({ limit: () => ({ toArray: async () => structuredClone(memberships.filter((m) => m.organizationId === query.organizationId)) }) }),
          }),
          countDocuments: async (query) => memberships.filter((m) => m.organizationId === query.organizationId).length,
          updateMany: async (query, update) => {
            let count = 0;
            memberships.forEach((m, idx) => {
              if ((query.membershipId?.$in || []).includes(m.membershipId)) {
                memberships[idx] = { ...m, ...(update.$set || {}) };
                count += 1;
              }
            });
            return { modifiedCount: count };
          },
          updateOne: async (query, update) => {
            const idx = memberships.findIndex((m) => m.organizationId === query.organizationId && m.membershipId === query.membershipId);
            if (idx >= 0) memberships[idx] = { ...memberships[idx], ...(update.$set || {}) };
            return { acknowledged: true };
          },
          createIndex: async () => ({}),
        };
      }

      if (name === 'branch_assignments') {
        return {
          insertOne: async (doc) => { assignments.push(structuredClone(doc)); return { acknowledged: true }; },
          findOne: async (query) => assignments.find((a) => {
            if (query.assignmentId) return a.assignmentId === query.assignmentId;
            if (query.organizationId && query.membershipId && query.branchId) {
              return a.organizationId === query.organizationId && a.membershipId === query.membershipId && a.branchId === query.branchId && (!query.status || a.status === query.status);
            }
            return false;
          }) || null,
          find: (query) => ({
            toArray: async () => structuredClone(assignments.filter((a) => {
              if (query.membershipId?.$in) return query.membershipId.$in.includes(a.membershipId) && (!query.status || a.status === query.status);
              if (query.organizationId && query.membershipId) return a.organizationId === query.organizationId && a.membershipId === query.membershipId;
              return false;
            })),
          }),
          updateOne: async (query, update) => {
            const idx = assignments.findIndex((a) => a.assignmentId === query.assignmentId || (a.organizationId === query.organizationId && a.membershipId === query.membershipId && a.assignmentId === query.assignmentId));
            if (idx >= 0) assignments[idx] = { ...assignments[idx], ...(update.$set || {}) };
            return { acknowledged: true };
          },
          createIndex: async () => ({}),
        };
      }

      if (name === 'membership_events') {
        return {
          insertOne: async (doc) => { events.push(structuredClone(doc)); return { acknowledged: true }; },
          find: (query) => ({
            sort: () => ({
              skip: () => ({
                limit: () => ({ toArray: async () => structuredClone(events.filter((e) => e.organizationId === query.organizationId && e.membershipId === query.membershipId)) }),
              }),
            }),
          }),
          countDocuments: async (query) => events.filter((e) => e.organizationId === query.organizationId && e.membershipId === query.membershipId).length,
          createIndex: async () => ({}),
        };
      }

      return { createIndex: async () => ({}) };
    },
  };
}

test('add member by NIN creates membership with null userId and allows multiple branch assignments', async () => {
  const app = buildApp({
    dbReady: true,
    db: makeFakeDb(),
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      if (u.includes('/nin/')) return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000001' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    },
  });

  const token = makeAccessToken({ sub: 'org-admin-1' }, 'change-me');

  const memberRes = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/members',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000001' },
  });

  assert.equal(memberRes.statusCode, 201);
  const membershipId = memberRes.json().membership.membershipId;
  assert.equal(memberRes.json().membership.userId, null);

  const assign1 = await app.inject({
    method: 'POST',
    url: `/orgs/org-1/members/${membershipId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { branchId: 'branch-1', roles: ['doctor'] },
  });
  assert.equal(assign1.statusCode, 201);

  const assign2 = await app.inject({
    method: 'POST',
    url: `/orgs/org-1/members/${membershipId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { branchId: 'branch-2', roles: ['regional_manager'] },
  });
  assert.equal(assign2.statusCode, 201);

  const getRes = await app.inject({
    method: 'GET',
    url: `/orgs/org-1/members/${membershipId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json().assignments.length, 2);
});

test('internal link-user links memberships by NIN', async () => {
  const app = buildApp({
    dbReady: true,
    db: makeFakeDb(),
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      if (u.includes('/nin/')) return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000077' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    },
  });
  const token = makeAccessToken({ sub: 'org-admin-1' }, 'change-me');

  const memberRes = await app.inject({
    method: 'POST',
    url: '/orgs/org-2/members',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000077' },
  });
  assert.equal(memberRes.statusCode, 201);

  const linkRes = await app.inject({
    method: 'POST',
    url: '/internal/memberships/link-user',
    headers: { 'x-internal-token': 'change-me-internal-token' },
    payload: { userId: 'user-200', nin: '90000000077' },
  });

  assert.equal(linkRes.statusCode, 200);
  assert.equal(linkRes.json().linked, 1);
});

test('rbac denial returns 403 for protected membership endpoint', async () => {
  const app = buildApp({
    dbReady: true,
    db: makeFakeDb(),
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: false }) };
      if (u.includes('/nin/')) return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000009' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    },
  });
  const token = makeAccessToken({ sub: 'staff-1' }, 'change-me');
  const res = await app.inject({
    method: 'POST',
    url: '/orgs/org-9/members',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000009' },
  });
  assert.equal(res.statusCode, 403);
});

test('transfer between branches creates history event', async () => {
  const app = buildApp({
    dbReady: true,
    db: makeFakeDb(),
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
      if (u.includes('/nin/')) return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000033' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    },
  });
  const token = makeAccessToken({ sub: 'org-admin-1' }, 'change-me');

  const memberRes = await app.inject({
    method: 'POST',
    url: '/orgs/org-3/members',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000033' },
  });
  const memberId = memberRes.json().membership.membershipId;

  await app.inject({
    method: 'POST',
    url: `/orgs/org-3/members/${memberId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { branchId: 'branch-a', roles: ['doctor'] },
  });

  const transferRes = await app.inject({
    method: 'POST',
    url: `/orgs/org-3/members/${memberId}/transfer`,
    headers: { authorization: `Bearer ${token}` },
    payload: { fromBranchId: 'branch-a', toBranchId: 'branch-b', reason: 'coverage update' },
  });
  assert.equal(transferRes.statusCode, 200);

  const historyRes = await app.inject({
    method: 'GET',
    url: `/orgs/org-3/members/${memberId}/history`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(historyRes.statusCode, 200);
  const eventTypes = historyRes.json().items.map((e) => e.eventType);
  assert.equal(eventTypes.includes('BRANCH_TRANSFERRED'), true);
});
