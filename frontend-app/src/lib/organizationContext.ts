import type { AppContext } from '@/types/auth';

export type OrganizationScopeKind = 'organization' | 'institution' | 'branch';

export function normalizeOrganizationRoleName(value: string | undefined): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return '';
  if (normalized === 'org_owner' || normalized === 'organization_owner') return 'owner';
  if (
    normalized === 'superstaff'
    || normalized === 'org_superstaff'
    || normalized === 'org_super_staff'
    || normalized === 'organization_superstaff'
    || normalized === 'organization_super_staff'
  ) {
    return 'super_staff';
  }
  return normalized;
}

export function getOrganizationIdFromContext(context: AppContext | null | undefined): string | undefined {
  if (!context) return undefined;
  if (context.organizationId) return context.organizationId;
  if (context.type === 'organization') {
    if (context.id.startsWith('org:')) {
      const parts = context.id.split(':');
      if (parts.length >= 2 && parts[1]) return parts[1];
    }
    return context.id;
  }
  return undefined;
}

export function getOrganizationScopeKind(context: AppContext | null | undefined): OrganizationScopeKind | null {
  if (!context || context.type !== 'organization') {
    return null;
  }
  if (context.branchId) {
    return 'branch';
  }
  if (context.institutionId) {
    return 'institution';
  }
  return 'organization';
}

export function isScopedCareContext(context: AppContext | null | undefined): boolean {
  const scopeKind = getOrganizationScopeKind(context);
  return scopeKind === 'institution' || scopeKind === 'branch';
}

export function getCareWorkspaceBasePath(context: AppContext | null | undefined): '/app/provider' | '/app/care' {
  return isScopedCareContext(context) ? '/app/care' : '/app/provider';
}

export function getOrganizationWorkspaceBasePath(
  pathname: string,
  context: AppContext | null | undefined,
): '/app/provider' | '/app/care' {
  if (pathname.startsWith('/app/care')) return '/app/care';
  if (pathname.startsWith('/app/provider')) return '/app/provider';
  return getCareWorkspaceBasePath(context);
}
