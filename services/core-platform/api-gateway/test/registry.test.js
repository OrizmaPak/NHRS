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

test('auth context switch route resolves permission', () => {
  const rule = findPermissionRule('POST', '/auth/context/switch');
  assert.equal(rule.permissionKey, 'auth.me.read');
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

test('doctor registry route mappings resolve expected permissions', () => {
  assert.equal(findPermissionRule('GET', '/doctors/search').public, true);
  assert.equal(findPermissionRule('POST', '/doctors/register').permissionKey, 'doctor.register');
  assert.equal(findPermissionRule('GET', '/doctors/doc-1').permissionKey, 'doctor.read');
  assert.equal(findPermissionRule('POST', '/licenses/doc-1/verify').permissionKey, 'doctor.verify');
  assert.equal(findPermissionRule('POST', '/licenses/doc-1/suspend').permissionKey, 'doctor.suspend');
  assert.equal(findPermissionRule('POST', '/licenses/doc-1/revoke').permissionKey, 'doctor.revoke');
  assert.equal(findPermissionRule('POST', '/licenses/doc-1/reinstate').permissionKey, 'doctor.reinstate');
});

test('emergency route mappings resolve expected permissions', () => {
  assert.equal(findPermissionRule('POST', '/emergency/requests').permissionKey, 'emergency.request.create');
  assert.equal(findPermissionRule('GET', '/emergency/requests').permissionKey, 'emergency.request.read');
  assert.equal(findPermissionRule('PATCH', '/emergency/requests/r-1/status').permissionKey, 'emergency.request.update_status');
  assert.equal(findPermissionRule('POST', '/emergency/requests/r-1/responses').permissionKey, 'emergency.response.create');
  assert.equal(findPermissionRule('GET', '/emergency/requests/r-1/room').permissionKey, 'emergency.room.read');
  assert.equal(findPermissionRule('POST', '/emergency/rooms/room-1/messages').permissionKey, 'emergency.room.message.create');
  assert.equal(findPermissionRule('PUT', '/emergency/inventory/me').permissionKey, 'emergency.inventory.upsert');
  assert.equal(findPermissionRule('GET', '/emergency/inventory/search').permissionKey, 'emergency.inventory.search');
});

test('governance taskforce route mappings resolve expected permissions', () => {
  assert.equal(findPermissionRule('POST', '/taskforce/units').permissionKey, 'taskforce.unit.create');
  assert.equal(findPermissionRule('GET', '/taskforce/units').permissionKey, 'taskforce.unit.read');
  assert.equal(findPermissionRule('PATCH', '/taskforce/units/u-1').permissionKey, 'taskforce.unit.update');
  assert.equal(findPermissionRule('POST', '/taskforce/units/u-1/members').permissionKey, 'taskforce.member.manage');
  assert.equal(findPermissionRule('POST', '/cases').permissionKey, 'governance.case.create');
  assert.equal(findPermissionRule('GET', '/cases').permissionKey, 'governance.case.read');
  assert.equal(findPermissionRule('PATCH', '/cases/c-1/status').permissionKey, 'governance.case.update_status');
  assert.equal(findPermissionRule('POST', '/cases/c-1/corrections/propose').permissionKey, 'governance.correction.propose');
  assert.equal(findPermissionRule('POST', '/cases/c-1/corrections/approve').permissionKey, 'governance.correction.approve');
  assert.equal(findPermissionRule('POST', '/cases/c-1/corrections/reject').permissionKey, 'governance.correction.reject');
  assert.equal(findPermissionRule('GET', '/cases/c-1/room').permissionKey, 'governance.case.room.read');
  assert.equal(findPermissionRule('POST', '/case-rooms/room-1/messages').permissionKey, 'governance.case.room.message.create');
  assert.equal(findPermissionRule('POST', '/cases/c-1/escalate').permissionKey, 'governance.case.escalate');
});

test('ui theme route mappings resolve expected permissions', () => {
  assert.equal(findPermissionRule('GET', '/ui/theme/platform').public, true);
  assert.equal(findPermissionRule('GET', '/ui/theme/effective').public, true);
  assert.equal(findPermissionRule('GET', '/ui/theme').permissionKey, 'ui.theme.read');
  assert.equal(findPermissionRule('POST', '/ui/theme').permissionKey, 'ui.theme.write');
  assert.equal(findPermissionRule('PATCH', '/ui/theme/theme-1').permissionKey, 'ui.theme.write');
  assert.equal(findPermissionRule('POST', '/ui/theme/theme-1/logo').permissionKey, 'ui.theme.write');
  assert.equal(findPermissionRule('DELETE', '/ui/theme/theme-1').permissionKey, 'ui.theme.delete');
});
