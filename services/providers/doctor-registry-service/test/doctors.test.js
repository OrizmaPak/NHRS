const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildApp } = require('../src/server');

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
  const doctors = [];
  const history = [];

  return {
    __inspect: { doctors, history },
    collection(name) {
      if (name === 'doctors') {
        return {
          createIndex: async () => ({}),
          insertOne: async (doc) => {
            if (doctors.some((d) => d.userId === doc.userId || d.licenseNumber === doc.licenseNumber)) {
              const err = new Error('duplicate key');
              err.code = 11000;
              throw err;
            }
            doctors.push(structuredClone(doc));
            return { acknowledged: true };
          },
          findOne: async (q) => doctors.find((d) => {
            if (q.doctorId) return d.doctorId === q.doctorId;
            if (q.userId) return d.userId === q.userId;
            return false;
          }) || null,
          updateOne: async (q, u) => {
            const idx = doctors.findIndex((d) => d.doctorId === q.doctorId);
            if (idx >= 0) doctors[idx] = { ...doctors[idx], ...(u.$set || {}) };
            return { acknowledged: true };
          },
          countDocuments: async (filter) => doctors.filter((d) => {
            if (filter.status && d.status !== filter.status) return false;
            if (filter.specialization && d.specialization !== filter.specialization) return false;
            if (filter.affiliations?.$elemMatch?.state) {
              const state = filter.affiliations.$elemMatch.state;
              if (!(d.affiliations || []).some((a) => a.state === state)) return false;
            }
            if (filter.$or) {
              const matches = filter.$or.some((cond) => {
                const [field, regex] = Object.entries(cond)[0];
                return regex.test(String(d[field] || ''));
              });
              if (!matches) return false;
            }
            return true;
          }).length,
          find: (filter) => {
            const items = doctors.filter((d) => {
              if (filter.status && d.status !== filter.status) return false;
              if (filter.specialization && d.specialization !== filter.specialization) return false;
              if (filter.affiliations?.$elemMatch?.state) {
                const state = filter.affiliations.$elemMatch.state;
                if (!(d.affiliations || []).some((a) => a.state === state)) return false;
              }
              if (filter.$or) {
                const matches = filter.$or.some((cond) => {
                  const [field, regex] = Object.entries(cond)[0];
                  return regex.test(String(d[field] || ''));
                });
                if (!matches) return false;
              }
              return true;
            });
            return {
              sort: () => ({
                skip: (n) => ({
                  limit: (l) => ({
                    toArray: async () => structuredClone(items.slice(n, n + l)),
                  }),
                }),
              }),
            };
          },
        };
      }

      if (name === 'license_history') {
        return {
          createIndex: async () => ({}),
          insertOne: async (doc) => {
            history.push(structuredClone(doc));
            return { acknowledged: true };
          },
          find: (q) => ({
            sort: () => ({
              toArray: async () => structuredClone(history.filter((h) => h.doctorId === q.doctorId)),
            }),
          }),
        };
      }

      return { createIndex: async () => ({}) };
    },
  };
}

function ctx(fetchImpl) {
  const db = makeDb();
  const app = buildApp({ dbReady: true, db, fetchImpl });
  return { app, db };
}

test('doctor registration creates doctor record with pending status', async () => {
  const { app, db } = ctx(async (url) => {
    if (String(url).includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true }) };
  });
  const token = makeToken({ sub: 'doctor-user-1', roles: ['citizen'] });
  const res = await app.inject({
    method: 'POST',
    url: '/doctors/register',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fullName: 'Dr. Test One',
      licenseNumber: 'LIC-001',
      licenseAuthority: 'MDCN',
      specialization: 'cardiology',
      affiliations: [{ orgId: 'org-1', branchId: 'b-1', state: 'Lagos' }],
    },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(db.__inspect.doctors.length, 1);
  assert.equal(db.__inspect.doctors[0].status, 'pending');
  assert.equal(db.__inspect.history[0].action, 'REGISTERED');
});

test('license verification changes doctor status to verified', async () => {
  const { app, db } = ctx(async (url) => {
    if (String(url).includes('/rbac/check')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ allowed: true }) };
    }
    return { ok: true, status: 202, text: async () => JSON.stringify({ accepted: true }) };
  });

  const doctorId = 'doc-verify-1';
  db.__inspect.doctors.push({
    doctorId,
    userId: 'doctor-user-2',
    fullName: 'Dr. Verify',
    licenseNumber: 'LIC-002',
    licenseAuthority: 'MDCN',
    specialization: 'general',
    affiliations: [],
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const regulatorToken = makeToken({ sub: 'regulator-1', roles: ['platform_admin'] });
  const res = await app.inject({
    method: 'POST',
    url: `/licenses/${doctorId}/verify`,
    headers: { authorization: `Bearer ${regulatorToken}` },
    payload: { notes: 'Validated by regulator' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().doctor.status, 'verified');
  assert.equal(db.__inspect.history.some((h) => h.action === 'VERIFIED'), true);
});

test('search returns verified doctors only', async () => {
  const { app, db } = ctx(async () => ({ ok: true, status: 202, text: async () => JSON.stringify({}) }));
  db.__inspect.doctors.push({
    doctorId: 'doc-a',
    userId: 'user-a',
    fullName: 'Dr. Verified',
    licenseNumber: 'LIC-100',
    licenseAuthority: 'MDCN',
    specialization: 'cardiology',
    affiliations: [{ orgId: 'org-1', state: 'Lagos' }],
    status: 'verified',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  db.__inspect.doctors.push({
    doctorId: 'doc-b',
    userId: 'user-b',
    fullName: 'Dr. Pending',
    licenseNumber: 'LIC-101',
    licenseAuthority: 'MDCN',
    specialization: 'cardiology',
    affiliations: [{ orgId: 'org-2', state: 'Abuja' }],
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await app.inject({
    method: 'GET',
    url: '/doctors/search?specialization=cardiology',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().items.length, 1);
  assert.equal(res.json().items[0].doctorId, 'doc-a');
});
