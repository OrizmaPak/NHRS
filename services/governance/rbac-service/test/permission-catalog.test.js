const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScopedPermissionCatalog, filterRulesToAllowedKeys } = require('../src/permission-catalog');

test('buildScopedPermissionCatalog keeps org system permissions and merges custom org permissions', () => {
  const catalog = buildScopedPermissionCatalog(
    [
      { key: 'profile.search', scope: 'org', module: 'profile', name: 'Search profiles', actions: ['read'] },
      { key: 'reports.view', scope: 'app', module: 'reports', name: 'View reports', actions: ['read'] },
    ],
    [
      { key: 'custom.org.permission', scope: 'org', organizationId: 'org-1', module: 'custom', description: 'Custom org permission' },
    ],
    'org',
    'org-1',
  );

  assert.deepEqual(
    catalog.map((entry) => entry.key),
    ['profile.search', 'custom.org.permission'],
  );
  assert.equal(catalog[0].organizationId, 'org-1');
});

test('filterRulesToAllowedKeys removes permissions outside the allowed org catalog', () => {
  const sanitized = filterRulesToAllowedKeys(
    [
      { permissionKey: 'profile.search', effect: 'allow' },
      { permissionKey: 'reports.view', effect: 'allow' },
      { permissionKey: 'custom.org.permission', effect: 'deny' },
    ],
    new Set(['profile.search', 'custom.org.permission']),
  );

  assert.deepEqual(sanitized, [
    { permissionKey: 'profile.search', effect: 'allow' },
    { permissionKey: 'custom.org.permission', effect: 'deny' },
  ]);
});
