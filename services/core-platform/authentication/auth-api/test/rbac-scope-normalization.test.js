const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAllowedPermissionKeys } = require('../src/rbac-scope');

test('normalizeAllowedPermissionKeys excludes denied rules', () => {
  const keys = normalizeAllowedPermissionKeys([
    { permissionKey: 'org.member.read', effect: 'allow' },
    { permissionKey: 'global.services.manage', effect: 'deny' },
    { permissionKey: 'integrations.view', granted: true },
    { permissionKey: 'api.keys.manage', granted: false },
  ]);

  assert.deepEqual(keys, ['org.member.read', 'integrations.view']);
});

test('normalizeAllowedPermissionKeys keeps legacy string permissions', () => {
  const keys = normalizeAllowedPermissionKeys([
    'profile.me.read',
    { permissionKey: 'profile.me.update', effect: 'allow' },
  ]);

  assert.deepEqual(keys, ['profile.me.read', 'profile.me.update']);
});
