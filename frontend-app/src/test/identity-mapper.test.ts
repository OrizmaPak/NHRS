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
});
