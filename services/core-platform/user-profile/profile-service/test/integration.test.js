const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPermission, emitAuditEvent, callJson } = require('../src/integration');

test('search permissions denied by RBAC check', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ allowed: false, reason: 'Permission denied' }),
  });

  const result = await checkPermission(fakeFetch, {
    rbacBaseUrl: 'http://rbac',
    authorization: 'Bearer token',
    permissionKey: 'profile.search',
  });

  assert.equal(result.allowed, false);
});

test('callJson parses downstream JSON payload', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ hello: 'world' }),
  });
  const result = await callJson(fakeFetch, 'http://x');
  assert.equal(result.ok, true);
  assert.equal(result.body.hello, 'world');
});

test('audit event emitter sends payload non-blocking', async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
    return { ok: true, status: 202, text: async () => '' };
  };

  emitAuditEvent(fakeFetch, 'http://audit', {
    eventType: 'PROFILE_UPDATED_SELF',
    userId: 'u1',
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(called, true);
});
