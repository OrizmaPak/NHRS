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

  const db = {
    __inspect: { memberships, assignments, events },
    collection(name) {
      if (name === 'org_memberships') {
        return {
          insertOne: async (doc) => { memberships.push(structuredClone(doc)); return { acknowledged: true }; },
          findOne: async (query) => memberships.find((m) => {
            if (query.membershipId) return m.membershipId === query.membershipId && (!query.organizationId || m.organizationId === query.organizationId);
            if (query.organizationId && query.nin) return m.organizationId === query.organizationId && m.nin === query.nin;
            if (query.organizationId && query.userId) return m.organizationId === query.organizationId && m.userId === query.userId;
            if (query.userId && !query.organizationId) return m.userId === query.userId;
            return false;
          }) || null,
          find: (query) => {
            let result = memberships.filter((m) => {
              if (query.membershipId?.$in) return query.membershipId.$in.includes(m.membershipId);
              if (query.userId && query.organizationId) {
                const statusMatch = query.status ? m.status === query.status : true;
                return m.userId === query.userId && m.organizationId === query.organizationId && statusMatch;
              }
              if (query.userId) {
                const statusMatch = query.status ? m.status === query.status : true;
                return m.userId === query.userId && statusMatch;
              }
              if (query.organizationId) return m.organizationId === query.organizationId;
              if (query.nin && query.userId === null) return m.nin === query.nin && m.userId === null;
              return true;
            });
            return {
              toArray: async () => structuredClone(result),
              skip: () => ({ limit: () => ({ toArray: async () => structuredClone(result) }) }),
            };
          },
          updateOne: async (query, update) => {
            const idx = memberships.findIndex((m) => m.membershipId === query.membershipId || (m.organizationId === query.organizationId && m.membershipId === query.membershipId));
            if (idx >= 0) memberships[idx] = { ...memberships[idx], ...(update.$set || {}) };
            return { acknowledged: true };
          },
          updateMany: async (query, update) => {
            memberships.forEach((m, i) => {
              if ((query.membershipId?.$in || []).includes(m.membershipId)) memberships[i] = { ...m, ...(update.$set || {}) };
            });
            return { acknowledged: true };
          },
          countDocuments: async (query) => memberships.filter((m) => m.organizationId === query.organizationId).length,
          createIndex: async () => ({}),
        };
      }

      if (name === 'branch_assignments') {
        return {
          insertOne: async (doc) => { assignments.push(structuredClone(doc)); return { acknowledged: true }; },
          findOne: async (query) => assignments.find((a) => {
            if (query.assignmentId) return a.assignmentId === query.assignmentId;
            if (query.organizationId && query.membershipId && query.branchId) {
              const statusMatch = query.status?.$in ? query.status.$in.includes(a.status) : (!query.status || a.status === query.status);
              return a.organizationId === query.organizationId && a.membershipId === query.membershipId && a.branchId === query.branchId && statusMatch;
            }
            return false;
          }) || null,
          find: (query) => {
            let result = assignments.filter((a) => {
              if (query.membershipId?.$in) return query.membershipId.$in.includes(a.membershipId);
              if (query.membershipId) return a.membershipId === query.membershipId && (!query.organizationId || a.organizationId === query.organizationId);
              return false;
            });
            return {
              sort: () => ({ toArray: async () => structuredClone(result.sort((x, y) => new Date(x.activeFrom || 0) - new Date(y.activeFrom || 0))) }),
              toArray: async () => structuredClone(result),
            };
          },
          updateOne: async (query, update) => {
            const idx = assignments.findIndex((a) => a.assignmentId === query.assignmentId || (a.organizationId === query.organizationId && a.membershipId === query.membershipId && a.assignmentId === query.assignmentId));
            if (idx >= 0) assignments[idx] = { ...assignments[idx], ...(update.$set || {}) };
            return { acknowledged: true };
          },
          createIndex: async () => ({}),
        };
      }

      if (name === 'membership_audit_log') {
        return {
          insertOne: async (doc) => { events.push(structuredClone(doc)); return { acknowledged: true }; },
          find: (query) => {
            const result = events.filter((e) => (!query.organizationId || e.organizationId === query.organizationId) && (!query.membershipId || e.membershipId === query.membershipId));
            return {
              sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => structuredClone(result) }) }) }),
            };
          },
          countDocuments: async (query) => events.filter((e) => (!query.organizationId || e.organizationId === query.organizationId) && (!query.membershipId || e.membershipId === query.membershipId)).length,
          createIndex: async () => ({}),
        };
      }

      return { createIndex: async () => ({}) };
    },
  };

  return db;
}

function buildTestApp({ allow = true } = {}) {
  const fakeDb = makeFakeDb();
  const app = buildApp({
    dbReady: true,
    db: fakeDb,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes('/rbac/check')) return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: allow }) };
      if (u.includes('/nin/')) return { ok: true, status: 200, text: async () => JSON.stringify({ nin: '90000000001' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({}) };
    },
  });
  return { app, fakeDb };
}

test('membership invite denied -> 403 and no db write', async () => {
  const { app, fakeDb } = buildTestApp({ allow: false });
  const token = makeAccessToken({ sub: 'user-1' }, 'change-me');
  const res = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000001', roles: ['doctor'], branchIds: ['b1'] },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(fakeDb.__inspect.memberships.length, 0);
});

test('membership invite allowed -> 201', async () => {
  const { app, fakeDb } = buildTestApp({ allow: true });
  const token = makeAccessToken({ sub: 'user-1' }, 'change-me');
  const res = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000001', roles: ['doctor'], branchIds: ['b1'] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(fakeDb.__inspect.memberships.length, 1);
});

test('assign user to multiple branches creates two assignments', async () => {
  const { app, fakeDb } = buildTestApp({ allow: true });
  const token = makeAccessToken({ sub: 'user-1' }, 'change-me');

  const invite = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000001', roles: ['doctor'], branchIds: [] },
  });
  const membershipId = invite.json().membership.membershipId;

  const assign = await app.inject({
    method: 'POST',
    url: `/orgs/org-1/memberships/${membershipId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { branchIds: ['b1', 'b2'], roles: ['doctor'] },
  });

  assert.equal(assign.statusCode, 201);
  assert.equal(fakeDb.__inspect.assignments.length, 2);
});

test('movement-history returns chronological timeline with activeTo set', async () => {
  const { app } = buildTestApp({ allow: true });
  const token = makeAccessToken({ sub: 'admin-1' }, 'change-me');

  const invite = await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000001', roles: ['doctor'], branchIds: ['b1'] },
  });
  const membershipId = invite.json().membership.membershipId;

  await app.inject({
    method: 'PATCH',
    url: `/orgs/org-1/memberships/${membershipId}/branches/b1`,
    headers: { authorization: `Bearer ${token}` },
    payload: { status: 'inactive', activeTo: '2026-01-01T00:00:00.000Z' },
  });

  await app.inject({
    method: 'POST',
    url: `/orgs/org-1/memberships/${membershipId}/branches`,
    headers: { authorization: `Bearer ${token}` },
    payload: { branchIds: ['b2'], roles: ['doctor'] },
  });

  await app.inject({
    method: 'POST',
    url: '/internal/memberships/link-user',
    headers: { 'x-internal-token': 'change-me-internal-token' },
    payload: { userId: 'user-200', nin: '90000000001' },
  });

  const history = await app.inject({
    method: 'GET',
    url: '/users/user-200/movement-history',
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(history.statusCode, 200);
  assert.equal(Array.isArray(history.json().timeline), true);
  assert.equal(history.json().timeline.length >= 2, true);
  assert.equal(history.json().timeline.some((x) => x.activeTo), true);
});

test('scope check returns allowed=false when user is not a member', async () => {
  const { app } = buildTestApp({ allow: true });
  const res = await app.inject({
    method: 'GET',
    url: '/orgs/org-1/memberships/me?userId=missing-user',
    headers: { 'x-internal-token': 'change-me-internal-token' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().allowed, false);
  assert.equal(res.json().membership, null);
  assert.deepEqual(res.json().assignments, []);
});

test('scope check returns allowed=false when member exists but branch assignment is missing', async () => {
  const { app } = buildTestApp({ allow: true });
  const token = makeAccessToken({ sub: 'admin-1' }, 'change-me');
  await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000001', roles: ['doctor'], branchIds: ['b1'] },
  });
  await app.inject({
    method: 'POST',
    url: '/internal/memberships/link-user',
    headers: { 'x-internal-token': 'change-me-internal-token' },
    payload: { userId: 'user-branch-miss', nin: '90000000001' },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/orgs/org-1/memberships/me?userId=user-branch-miss&branchId=missing-branch',
    headers: { 'x-internal-token': 'change-me-internal-token' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().allowed, false);
  assert.equal(res.json().membership.userId, 'user-branch-miss');
});

test('scope check returns allowed=true when member and branch assignment exist', async () => {
  const { app } = buildTestApp({ allow: true });
  const token = makeAccessToken({ sub: 'admin-1' }, 'change-me');
  await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000002', roles: ['doctor'], branchIds: ['b2'] },
  });
  await app.inject({
    method: 'POST',
    url: '/internal/memberships/link-user',
    headers: { 'x-internal-token': 'change-me-internal-token' },
    payload: { userId: 'user-branch-hit', nin: '90000000002' },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/orgs/org-1/memberships/me?userId=user-branch-hit&branchId=b2',
    headers: { 'x-internal-token': 'change-me-internal-token' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().allowed, true);
  assert.equal(Array.isArray(res.json().assignments), true);
  assert.equal(res.json().assignments.some((a) => a.branchId === 'b2'), true);
});

test('users memberships endpoint returns active memberships with branches shape', async () => {
  const { app } = buildTestApp({ allow: true });
  const token = makeAccessToken({ sub: 'admin-1' }, 'change-me');

  await app.inject({
    method: 'POST',
    url: '/orgs/org-1/memberships/invite',
    headers: { authorization: `Bearer ${token}` },
    payload: { nin: '90000000003', roles: ['doctor'], branchIds: ['b3'] },
  });
  await app.inject({
    method: 'POST',
    url: '/internal/memberships/link-user',
    headers: { 'x-internal-token': 'change-me-internal-token' },
    payload: { userId: 'user-summary-1', nin: '90000000003' },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/users/user-summary-1/memberships?includeBranches=true',
    headers: { 'x-internal-token': 'change-me-internal-token' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().userId, 'user-summary-1');
  assert.equal(Array.isArray(res.json().memberships), true);
  assert.equal(res.json().memberships[0].membershipStatus, 'active');
  assert.equal(Array.isArray(res.json().memberships[0].branches), true);
  assert.equal(res.json().memberships[0].branches[0].branchId, 'b3');
});
