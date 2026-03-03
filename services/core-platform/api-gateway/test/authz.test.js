const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthzResponse } = require('../src/authz');

test('public route proceeds', () => {
  const res = evaluateAuthzResponse({
    rule: { public: true },
    hasBearerToken: false,
    checkStatus: 200,
    checkBody: { allowed: true },
  });
  assert.equal(res.proceed, true);
});

test('missing bearer token denies with 401', () => {
  const res = evaluateAuthzResponse({
    rule: { permissionKey: 'nin.profile.read' },
    hasBearerToken: false,
    checkStatus: 401,
    checkBody: null,
  });
  assert.equal(res.proceed, false);
  assert.equal(res.statusCode, 401);
});

test('rbac 503 returns service unavailable', () => {
  const res = evaluateAuthzResponse({
    rule: { permissionKey: 'nin.profile.read' },
    hasBearerToken: true,
    checkStatus: 503,
    checkBody: null,
  });
  assert.equal(res.proceed, false);
  assert.equal(res.statusCode, 503);
});

test('explicit deny from check returns 403', () => {
  const res = evaluateAuthzResponse({
    rule: { permissionKey: 'nin.profile.read' },
    hasBearerToken: true,
    checkStatus: 200,
    checkBody: { allowed: false, reason: 'Permission denied', matchedRules: {} },
  });
  assert.equal(res.proceed, false);
  assert.equal(res.statusCode, 403);
});

test('allow from check proceeds', () => {
  const res = evaluateAuthzResponse({
    rule: { permissionKey: 'nin.profile.read' },
    hasBearerToken: true,
    checkStatus: 200,
    checkBody: { allowed: true },
  });
  assert.equal(res.proceed, true);
});
