const test = require('node:test');
const assert = require('node:assert/strict');

function makeBearer(sub) {
  const payload = Buffer.from(JSON.stringify({ sub, roles: ['tester'] }), 'utf8').toString('base64url');
  return `Bearer hdr.${payload}.sig`;
}

test('auth rate limit returns 429 after threshold', async () => {
  process.env.NODE_ENV = 'test';
  const { buildApp } = require('../src/server');
  const app = await buildApp({
    dbReady: false,
    redisReady: false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({ ok: true }),
    }),
  });

  let last;
  for (let i = 0; i < 11; i += 1) {
    last = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { method: 'nin', nin: '90000000001', password: '01011990' },
    });
  }
  assert.equal(last.statusCode, 429);
  assert.ok(last.body.length > 0);
});

test('idempotency key replays identical critical POST response', async () => {
  process.env.NODE_ENV = 'test';
  const { buildApp } = require('../src/server');
  let emergencyCalls = 0;
  const app = await buildApp({
    dbReady: false,
    redisReady: false,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/rbac/check')) {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          text: async () => JSON.stringify({ allowed: true, reason: null }),
        };
      }
      if (target.includes('/emergency/requests')) {
        emergencyCalls += 1;
      }
      return {
        ok: true,
        status: 201,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ requestId: 'em-1' }),
      };
    },
  });

  const headers = {
    authorization: makeBearer('user-idem'),
    'idempotency-key': 'idem-1',
  };
  const one = await app.inject({
    method: 'POST',
    url: '/emergency/requests',
    headers,
    payload: {
      title: 'Need blood',
      description: 'A+',
      category: 'blood',
      urgency: 'critical',
      scope: { level: 'STATE', state: 'Lagos' },
      location: { state: 'Lagos', lga: 'Ikeja' },
    },
  });
  assert.equal(one.statusCode, 201);

  const two = await app.inject({
    method: 'POST',
    url: '/emergency/requests',
    headers,
    payload: {
      title: 'Need blood',
      description: 'A+',
      category: 'blood',
      urgency: 'critical',
      scope: { level: 'STATE', state: 'Lagos' },
      location: { state: 'Lagos', lga: 'Ikeja' },
    },
  });
  assert.equal(two.statusCode, 201);
  assert.equal(two.headers['x-idempotency-replayed'], 'true');
  assert.equal(emergencyCalls, 1);
});
