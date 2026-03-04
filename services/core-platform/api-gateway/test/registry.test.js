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

test('organization branch route resolves org-scoped permission', () => {
  const rule = findPermissionRule('POST', '/orgs/org-1/branches');
  assert.equal(rule.permissionKey, 'org.branch.create');
});

test('organization search route resolves org.search permission', () => {
  const rule = findPermissionRule('GET', '/orgs/search');
  assert.equal(rule.permissionKey, 'org.search');
});

test('organization list route resolves org.list permission', () => {
  const rule = findPermissionRule('GET', '/orgs');
  assert.equal(rule.permissionKey, 'org.list');
});

test('membership transfer route resolves permission', () => {
  const rule = findPermissionRule('POST', '/orgs/org-1/members/member-1/transfer');
  assert.equal(rule.permissionKey, 'org.member.transfer');
});

test('membership status route resolves updated status permission key', () => {
  const rule = findPermissionRule('PATCH', '/orgs/org-1/members/member-1/status');
  assert.equal(rule.permissionKey, 'org.member.status.update');
});

test('membership invite route resolves org.member.invite permission', () => {
  const rule = findPermissionRule('POST', '/orgs/org-1/memberships/invite');
  assert.equal(rule.permissionKey, 'org.member.invite');
});

test('unknown route has no permission mapping', () => {
  const rule = findPermissionRule('GET', '/unknown/path');
  assert.equal(rule, undefined);
});

test('internal membership linking route is not publicly mapped', () => {
  const rule = findPermissionRule('POST', '/internal/memberships/link-user');
  assert.equal(rule, undefined);
});
