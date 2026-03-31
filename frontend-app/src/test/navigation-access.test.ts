import { describe, expect, it } from 'vitest';
import { getContextFallbackPermissions } from '@/lib/contextPermissionFallback';
import { isNavigationItemVisibleInContext } from '@/lib/navigationAccess';
import { navigationItems } from '@/routes/navigation';
import type { AppContext } from '@/types/auth';

function makeOrganizationContext(overrides: Partial<AppContext>): AppContext {
  const base: AppContext = {
    id: 'org:org-1:role:owner',
    type: 'organization',
    name: 'North Hospital Group',
    subtitle: 'Organization / Owner',
    roleName: 'owner',
    themeScopeType: 'organization',
    themeScopeId: 'org-1',
    permissions: [],
    organizationId: 'org-1',
  };
  const context = { ...base, ...overrides };
  return {
    ...context,
    permissions: overrides.permissions ?? getContextFallbackPermissions(context),
  };
}

function makePublicContext(overrides: Partial<AppContext> = {}): AppContext {
  return {
    id: 'public:self',
    type: 'public',
    name: 'Citizen Workspace',
    subtitle: 'Citizen',
    roleName: 'citizen',
    themeScopeType: 'platform',
    themeScopeId: 'platform',
    permissions: ['records.me.read', 'doctor.search'],
    ...overrides,
  };
}

describe('isNavigationItemVisibleInContext', () => {
  const careItems = navigationItems.filter((item) => item.group === 'Care');
  const providerItems = navigationItems.filter((item) => item.group === 'Provider');
  const publicItems = navigationItems.filter((item) => item.group === 'Public');
  const integrationsItem = navigationItems.find((item) => item.label === 'Integrations');
  const permissionsItem = navigationItems.find((item) => item.label === 'Permissions');
  const timelineItem = navigationItems.find((item) => item.label === 'My Timeline');
  const doctorRegistryItem = navigationItems.find((item) => item.label === 'Doctor Registry');

  it('keeps provider navigation visible in organization scope', () => {
    const context = makeOrganizationContext({ roleName: 'manager' });

    for (const item of providerItems) {
      expect(isNavigationItemVisibleInContext(item, context)).toBe(true);
    }
  });

  it('keeps provider navigation visible in institution scope', () => {
    const context = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:role:manager',
      roleName: 'manager',
      subtitle: 'Institution / Manager',
      institutionId: 'inst-1',
    });

    for (const item of providerItems) {
      expect(isNavigationItemVisibleInContext(item, context)).toBe(true);
    }
  });

  it('keeps provider navigation visible in branch scope', () => {
    const context = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:branch:branch-1:role:manager',
      roleName: 'manager',
      subtitle: 'Branch / Manager',
      institutionId: 'inst-1',
      branchId: 'branch-1',
    });

    for (const item of providerItems) {
      expect(isNavigationItemVisibleInContext(item, context)).toBe(true);
    }
  });

  it('keeps care navigation visible in organization scope', () => {
    const context = makeOrganizationContext({ roleName: 'manager' });

    for (const item of careItems) {
      expect(isNavigationItemVisibleInContext(item, context)).toBe(true);
    }
  });

  it('keeps care navigation visible in institution scope', () => {
    const context = makeOrganizationContext({
      id: 'org:org-1:role:manager',
      institutionId: 'inst-1',
      roleName: 'manager',
      subtitle: 'Institution / Manager',
    });

    for (const item of careItems) {
      expect(isNavigationItemVisibleInContext(item, context)).toBe(true);
    }
  });

  it('keeps care navigation visible in branch scope', () => {
    const context = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:branch:branch-1:role:manager',
      roleName: 'manager',
      subtitle: 'Branch / Manager',
      institutionId: 'inst-1',
      branchId: 'branch-1',
    });

    for (const item of careItems) {
      expect(isNavigationItemVisibleInContext(item, context)).toBe(true);
    }
  });

  it('keeps doctor registry visible in institution and branch contexts, but hides my timeline there', () => {
    const institutionContext = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:role:manager',
      roleName: 'manager',
      subtitle: 'Institution / Manager',
      institutionId: 'inst-1',
    });
    const branchContext = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:branch:branch-1:role:manager',
      roleName: 'manager',
      subtitle: 'Branch / Manager',
      institutionId: 'inst-1',
      branchId: 'branch-1',
    });

    expect(publicItems.length).toBeGreaterThan(0);
    expect(doctorRegistryItem && isNavigationItemVisibleInContext(doctorRegistryItem, institutionContext)).toBe(true);
    expect(doctorRegistryItem && isNavigationItemVisibleInContext(doctorRegistryItem, branchContext)).toBe(true);
    expect(timelineItem && isNavigationItemVisibleInContext(timelineItem, institutionContext)).toBe(false);
    expect(timelineItem && isNavigationItemVisibleInContext(timelineItem, branchContext)).toBe(false);
  });

  it('shows my timeline in public citizen context only', () => {
    const publicContext = makePublicContext();

    expect(timelineItem && isNavigationItemVisibleInContext(timelineItem, publicContext)).toBe(true);
  });

  it('keeps integrations and administration items visible across organization scopes', () => {
    const branchContext = makeOrganizationContext({
      id: 'org:org-1:institution:inst-1:branch:branch-1:role:manager',
      roleName: 'manager',
      subtitle: 'Branch / Manager',
      institutionId: 'inst-1',
      branchId: 'branch-1',
    });

    expect(integrationsItem && isNavigationItemVisibleInContext(integrationsItem, branchContext)).toBe(true);
    expect(permissionsItem && isNavigationItemVisibleInContext(permissionsItem, branchContext)).toBe(true);
  });
});
