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

test('records route mappings resolve expected permissions', () => {
  assert.equal(findPermissionRule('GET', '/records/me').permissionKey, 'records.me.read');
  assert.equal(findPermissionRule('GET', '/records/90000000001').permissionKey, 'records.nin.read');
  assert.equal(findPermissionRule('POST', '/records/me/symptoms').permissionKey, 'records.symptoms.create');
  assert.equal(findPermissionRule('POST', '/records/90000000001/entries').permissionKey, 'records.entry.create');
  assert.equal(findPermissionRule('PATCH', '/records/entries/e-1').permissionKey, 'records.entry.update');
  assert.equal(findPermissionRule('POST', '/records/entries/e-1/hide').permissionKey, 'records.entry.hide');
});

test('provider module route mappings resolve expected permissions', () => {
  assert.equal(findPermissionRule('POST', '/encounters/90000000001').permissionKey, 'encounters.create');
  assert.equal(findPermissionRule('GET', '/encounters/90000000001').permissionKey, 'encounters.read');
  assert.equal(findPermissionRule('PATCH', '/encounters/id/e-1').permissionKey, 'encounters.update');
  assert.equal(findPermissionRule('POST', '/labs/90000000001/results').permissionKey, 'labs.create');
  assert.equal(findPermissionRule('GET', '/labs/results/id/r-1').permissionKey, 'labs.read');
  assert.equal(findPermissionRule('PATCH', '/labs/results/id/r-1').permissionKey, 'labs.update');
  assert.equal(findPermissionRule('POST', '/pharmacy/90000000001/dispenses').permissionKey, 'pharmacy.create');
  assert.equal(findPermissionRule('GET', '/pharmacy/dispenses/id/d-1').permissionKey, 'pharmacy.read');
  assert.equal(findPermissionRule('PATCH', '/pharmacy/dispenses/id/d-1').permissionKey, 'pharmacy.update');
});
