import { describe, expect, it } from 'vitest';
import { getContextFallbackPermissions } from '@/lib/contextPermissionFallback';

describe('getContextFallbackPermissions', () => {
  it('adds the scoped care baseline for institution contexts', () => {
    const permissions = getContextFallbackPermissions({
      id: 'org:org-1:institution:inst-1:role:manager',
      type: 'organization',
      name: 'Warri General',
      subtitle: 'Institution / Manager',
      roleName: 'manager',
      themeScopeType: 'organization',
      themeScopeId: 'org-1',
      organizationId: 'org-1',
      institutionId: 'inst-1',
      permissions: [],
    });

    expect(permissions).toEqual(
      expect.arrayContaining([
        'auth.me.read',
        'care.workspace.read',
        'profile.search',
        'profile.user.read',
        'records.nin.read',
      ]),
    );
  });
});
