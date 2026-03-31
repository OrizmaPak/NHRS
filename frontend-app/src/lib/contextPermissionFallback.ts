import type { AppContext } from '@/types/auth';
import { normalizeOrganizationRoleName } from '@/lib/organizationContext';

export const SCOPED_CARE_FOUNDATION_PERMISSION_KEYS = [
  'auth.me.read',
  'care.workspace.read',
  'profile.search',
  'profile.user.read',
  'profile.placeholder.create',
  'records.nin.read',
] as const;

export const ORG_WORKSPACE_PERMISSION_KEYS = [
  'auth.me.read',
  'care.workspace.read',
  'profile.search',
  'profile.user.read',
  'profile.user.update',
  'profile.placeholder.create',
  'records.nin.read',
  'encounters.read',
  'labs.read',
  'pharmacy.read',
  'ui.theme.write',
  'integrations.view',
  'api.keys.manage',
  'rbac.org.manage',
  'org.list',
  'org.read',
  'org.update',
  'org.owner.assign',
  'global.services.manage',
  'global.services.create',
  'global.services.update',
  'global.services.delete',
  'org.branch.create',
  'org.branch.read',
  'org.branch.update',
  'org.branch.delete',
  'org.member.add',
  'org.member.invite',
  'org.member.read',
  'org.member.list',
  'org.member.update',
  'org.member.status.update',
  'org.branch.assign',
  'org.branch.assignment.update',
  'org.member.branch.assign',
  'org.member.branch.update',
  'org.member.branch.remove',
  'org.member.transfer',
  'org.member.history.read',
] as const;

function isScopedOrganizationContext(context: AppContext): boolean {
  return context.type === 'organization' && Boolean(context.institutionId || context.branchId);
}

export function getContextFallbackPermissions(context: AppContext | null | undefined): string[] {
  if (!context) return [];
  if (context.type === 'platform' && context.id === 'app:super') {
    return ['*'];
  }

  if (context.type !== 'organization') {
    return Array.isArray(context.permissions) ? context.permissions : [];
  }

  const roleName = normalizeOrganizationRoleName(context.roleName);
  if (roleName === 'owner') {
    return Array.from(new Set(['auth.me.read', ...ORG_WORKSPACE_PERMISSION_KEYS]));
  }
  if (roleName === 'super_staff') {
    return Array.from(new Set(['auth.me.read', ...ORG_WORKSPACE_PERMISSION_KEYS]));
  }
  if (isScopedOrganizationContext(context)) {
    return Array.from(
      new Set([
        ...SCOPED_CARE_FOUNDATION_PERMISSION_KEYS,
        ...(Array.isArray(context.permissions) ? context.permissions : []),
      ]),
    );
  }

  return Array.isArray(context.permissions) ? context.permissions : [];
}

export function mergeContextPermissions(...permissionSets: Array<string[] | null | undefined>): string[] {
  return Array.from(
    new Set(
      permissionSets
        .flatMap((items) => (Array.isArray(items) ? items : []))
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}
