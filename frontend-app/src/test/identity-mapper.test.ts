import { describe, expect, it } from 'vitest';
import { toIdentityResponse } from '@/api/hooks/identityMapper';

describe('toIdentityResponse', () => {
  it('keeps app permissions separate from organization-scoped permissions', () => {
    const identity = toIdentityResponse({
      user: {
        id: 'user-1',
        firstName: 'Ada',
        lastName: 'Tester',
        email: 'ada@example.com',
        roles: ['manager'],
        scope: ['profile.me.read'],
      },
      permissions: ['dashboard.read'],
      appPermissions: ['dashboard.read'],
      rbacScope: {
        appScopePermissions: ['settings.read'],
        appRoles: ['manager'],
        orgScopePermissions: [
          {
            organizationId: 'org-1',
            permissions: ['org.member.read', 'org.member.update'],
            roles: ['owner'],
          },
        ],
      },
      availableContexts: [
        {
          id: 'org:org-1:role:owner',
          type: 'organization',
          name: 'Delta State Government Hospital',
          subtitle: 'Organization / Owner',
          permissions: ['org.member.read', 'org.member.update'],
          organizationId: 'org-1',
          roleName: 'owner',
          themeScopeType: 'organization',
          themeScopeId: 'org-1',
        },
      ],
      defaultContextId: 'org:org-1:role:owner',
    });

    expect(identity.permissions.sort()).toEqual(['dashboard.read', 'profile.me.read', 'settings.read'].sort());
    expect(identity.permissions).not.toContain('org.member.read');
    expect(identity.permissions).not.toContain('org.member.update');
    expect(identity.orgPermissions).toEqual([
      {
        organizationId: 'org-1',
        permissions: ['org.member.read', 'org.member.update'],
        roles: ['owner'],
      },
    ]);
  });

  it('ignores denied permission entries from structured scope payloads', () => {
    const identity = toIdentityResponse({
      user: {
        id: 'user-2',
        firstName: 'Ben',
        lastName: 'Manager',
        email: 'ben@example.com',
        roles: ['manager'],
      },
      rbacScope: {
        appScopePermissions: [
          { permissionKey: 'dashboard.read', effect: 'allow' },
          { permissionKey: 'reports.view', effect: 'deny' },
        ],
        orgScopePermissions: [
          {
            organizationId: 'org-1',
            permissions: [
              { permissionKey: 'integrations.view', effect: 'allow' },
              { permissionKey: 'global.services.manage', effect: 'deny' },
            ],
            roles: ['manager'],
          },
        ],
      },
    });

    expect(identity.permissions).toContain('dashboard.read');
    expect(identity.permissions).not.toContain('reports.view');
    expect(identity.orgPermissions).toEqual([
      {
        organizationId: 'org-1',
        permissions: ['integrations.view'],
        roles: ['manager'],
      },
    ]);
  });
});
