const test = require('node:test');
const assert = require('node:assert/strict');
const { findPermissionRule } = require('../src/permissions/registry');

test('public login route', () => {
  const rule = findPermissionRule('POST', '/auth/login');
  assert.equal(rule.public, true);
});

test('nin read requires permission', () => {
  const rule = findPermissionRule('GET', '/nin/90000000001');
  assert.equal(rule.permissionKey, 'nin.profile.read');
});

test('org admin route resolves org-scoped permission', () => {
  const rule = findPermissionRule('POST', '/rbac/org/org-1/roles');
  assert.equal(rule.permissionKey, 'rbac.org.manage');
});

test('profile search route resolves permission', () => {
  const rule = findPermissionRule('GET', '/profile/search');
  assert.equal(rule.permissionKey, 'profile.search');
});

test('unknown route has no permission mapping', () => {
  const rule = findPermissionRule('GET', '/unknown/path');
  assert.equal(rule, undefined);
});
