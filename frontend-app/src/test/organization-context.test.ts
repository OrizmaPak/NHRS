import { describe, expect, it } from 'vitest';
import { getOrganizationWorkspaceBasePath } from '@/lib/organizationContext';
import type { AppContext } from '@/types/auth';

function makeOrganizationContext(overrides: Partial<AppContext>): AppContext {
  return {
    id: 'org:org-1:role:manager',
    type: 'organization',
    name: 'North Hospital Group',
    subtitle: 'Organization / Manager',
    roleName: 'manager',
    themeScopeType: 'organization',
    themeScopeId: 'org-1',
    permissions: [],
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('getOrganizationWorkspaceBasePath', () => {
  it('keeps provider routes in provider mode for institution and branch contexts', () => {
    const institutionContext = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:role:manager',
      subtitle: 'Institution / Manager',
      institutionId: 'inst-1',
    });
    const branchContext = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:branch:branch-1:role:manager',
      subtitle: 'Branch / Manager',
      institutionId: 'inst-1',
      branchId: 'branch-1',
    });

    expect(getOrganizationWorkspaceBasePath('/app/provider/patients', institutionContext)).toBe('/app/provider');
    expect(getOrganizationWorkspaceBasePath('/app/provider/intake', branchContext)).toBe('/app/provider');
  });

  it('keeps care routes in care mode for all organization scopes', () => {
    const organizationContext = makeOrganizationContext({});
    const institutionContext = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:role:manager',
      subtitle: 'Institution / Manager',
      institutionId: 'inst-1',
    });

    expect(getOrganizationWorkspaceBasePath('/app/care/patients', organizationContext)).toBe('/app/care');
    expect(getOrganizationWorkspaceBasePath('/app/care/intake', institutionContext)).toBe('/app/care');
  });
});
