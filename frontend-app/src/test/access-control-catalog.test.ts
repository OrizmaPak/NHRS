import { describe, expect, it } from 'vitest';
import { getAppPermissionCatalog, getOrganizationPermissionCatalog, type PermissionRow } from '@/api/hooks/useAccessControl';

function permissionRow(overrides: Partial<PermissionRow>): PermissionRow {
  return {
    key: 'auth.me.read',
    module: 'auth',
    description: 'Read own profile',
    scope: 'app',
    createdAt: '2026-03-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('getAppPermissionCatalog', () => {
  it('filters out the legacy superadmin-only pseudo permission', () => {
    const rows = getAppPermissionCatalog([
      permissionRow({ key: 'rbac.app.manage', module: 'rbac', description: 'Manage app RBAC' }),
      permissionRow({ key: 'superadmin.only', module: 'admin', description: 'Legacy super-only access' }),
    ]);

    expect(rows.map((entry) => entry.key)).toEqual(['rbac.app.manage']);
  });

  it('attaches platform interface metadata without leaking organization-only routes', () => {
    const rows = getAppPermissionCatalog([
      permissionRow({ key: 'rbac.app.manage', module: 'rbac', description: 'Manage app RBAC' }),
      permissionRow({ key: 'profile.user.read', module: 'profile', description: 'Read user profile' }),
    ]);

    const appRbac = rows.find((entry) => entry.key === 'rbac.app.manage');
    const profileRead = rows.find((entry) => entry.key === 'profile.user.read');

    expect(appRbac?.interfaceRoute).toBe('/app/admin/access/app-permissions');
    expect(appRbac?.interfaceLabel).toBe('App Permissions');
    expect(profileRead?.interfaceRoute).toBeUndefined();
    expect(profileRead?.interfaceLabel).toBeUndefined();
  });
});

describe('getOrganizationPermissionCatalog', () => {
  it('keeps true org-scope permissions and excludes app-only leaks', () => {
    const rows = getOrganizationPermissionCatalog([
      permissionRow({ key: 'profile.search', module: 'profile', description: 'Search profiles', scope: 'organization' }),
      permissionRow({ key: 'sync.monitor.view', module: 'integrations', description: 'View sync monitor', scope: 'app' }),
      permissionRow({ key: 'org.deleted.read', module: 'organization', description: 'Read deleted orgs', scope: 'app' }),
    ]);

    expect(rows.map((entry) => entry.key)).toEqual(['profile.search']);
    expect(rows[0]?.interfaceRoute).toBe('/app/provider/dashboard');
  });
});
