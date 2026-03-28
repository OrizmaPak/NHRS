import type { AppContext, IdentityResponse, ThemeScopeType, UserProfile } from '@/types/auth';

function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        return String(obj.permissionKey ?? obj.key ?? obj.permission ?? '');
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeRoleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        return String(obj.roleKey ?? obj.role ?? obj.name ?? obj.key ?? '');
      }
      return '';
    })
    .filter(Boolean);
}

function resolveRbacScopeRecord(source: Record<string, unknown>): Record<string, unknown> | null {
  if (source.rbacScope && typeof source.rbacScope === 'object') {
    return source.rbacScope as Record<string, unknown>;
  }
  if (source.rbacSummary && typeof source.rbacSummary === 'object') {
    return source.rbacSummary as Record<string, unknown>;
  }
  return null;
}

function collectRoles(source: Record<string, unknown>, rawUser: Record<string, unknown>): string[] {
  const rbacScope = resolveRbacScopeRecord(source);
  const appRolesFromRbac = normalizeRoleList(rbacScope?.appRoles);
  const orgRolesFromRbac = Array.isArray(rbacScope?.orgRoles)
    ? (rbacScope?.orgRoles as Array<Record<string, unknown>>).flatMap((entry) =>
        normalizeRoleList(entry.roles ?? entry.roleKeys),
      )
    : Array.isArray(rbacScope?.orgScopePermissions)
      ? (rbacScope?.orgScopePermissions as Array<Record<string, unknown>>).flatMap((entry) =>
          normalizeRoleList(entry.roles),
        )
    : [];

  const merged = new Set<string>([
    ...normalizeRoleList(source.roles),
    ...normalizeRoleList(rawUser.roles),
    ...normalizeRoleList(rawUser.appRoles),
    ...normalizeRoleList(rawUser.roleKeys),
    ...appRolesFromRbac,
    ...orgRolesFromRbac,
  ]);

  return Array.from(merged);
}

function collectAppLevelRoles(source: Record<string, unknown>, rawUser: Record<string, unknown>): string[] {
  const rbacScope = resolveRbacScopeRecord(source);
  const appRolesFromRbac = normalizeRoleList(rbacScope?.appRoles);
  const orgRolesFromRbac = Array.isArray(rbacScope?.orgRoles)
    ? (rbacScope?.orgRoles as Array<Record<string, unknown>>).flatMap((entry) =>
        normalizeRoleList(entry.roles ?? entry.roleKeys),
      )
    : Array.isArray(rbacScope?.orgScopePermissions)
      ? (rbacScope?.orgScopePermissions as Array<Record<string, unknown>>).flatMap((entry) =>
          normalizeRoleList(entry.roles),
        )
    : [];
  const orgRolesSet = new Set(orgRolesFromRbac.map((role) => role.trim().toLowerCase()));

  const merged = new Set<string>([
    ...normalizeRoleList(source.roles),
    ...normalizeRoleList(rawUser.roles),
    ...normalizeRoleList(rawUser.appRoles),
    ...normalizeRoleList(rawUser.roleKeys),
    ...appRolesFromRbac,
  ]);

  return Array.from(merged).filter((role) => !orgRolesSet.has(role.trim().toLowerCase()));
}

function isSuperRole(role: string): boolean {
  const normalized = role.trim().toLowerCase().replace(/\s+/g, '_');
  return ['super', 'superadmin', 'super_admin', 'platform_admin', 'app_admin', 'admin'].includes(normalized);
}

function ensureAppLevelContexts(
  contexts: AppContext[],
  isSuperAdmin: boolean,
  citizenPermissions: string[],
): AppContext[] {
  const byId = new Map(contexts.map((ctx) => [ctx.id, ctx] as const));
  const citizen: AppContext = byId.get('app:citizen') ?? {
    id: 'app:citizen',
    type: 'platform',
    name: 'Citizen',
    subtitle: 'App Level',
    themeScopeType: 'platform',
    themeScopeId: null,
    permissions: citizenPermissions,
  };
  if (!byId.get('app:citizen') && citizenPermissions.length > 0) {
    citizen.permissions = citizenPermissions;
  } else if (byId.get('app:citizen')) {
    citizen.permissions = citizen.permissions?.length ? citizen.permissions : citizenPermissions;
  }

  if (isSuperAdmin) {
    const superContext: AppContext = byId.get('app:super') ?? {
      id: 'app:super',
      type: 'platform',
      name: 'Super',
      subtitle: 'App Level',
      themeScopeType: 'platform',
      themeScopeId: null,
      permissions: ['*'],
    };

    const withoutSynthetic = contexts.filter((ctx) => ctx.id !== 'app:super' && ctx.id !== 'app:citizen');
    return [superContext, citizen, ...withoutSynthetic];
  }

  const withoutSynthetic = contexts.filter((ctx) => ctx.id !== 'app:super' && ctx.id !== 'app:citizen');
  return [citizen, ...withoutSynthetic];
}

function getCitizenOnlyPermissions(
  source: Record<string, unknown>,
  rawUser: Record<string, unknown>,
): string[] {
  const mergedRoles = new Set<string>([
    ...normalizeRoleList(source.roles),
    ...normalizeRoleList(rawUser.roles),
    ...normalizeRoleList(rawUser.appRoles),
    ...normalizeRoleList(rawUser.roleKeys),
    'citizen',
  ]);

  const isCitizenOnly = Array.from(mergedRoles).every((role) => role.trim().toLowerCase() === 'citizen');
  if (!isCitizenOnly) {
    return [];
  }

  const directUserScope = normalizePermissionList(rawUser.scope);
  const topLevelScope = normalizePermissionList(source.scope);
  const topLevelPermissions = normalizePermissionList(source.appPermissions ?? source.permissions);
  const merged = new Set<string>([
    ...directUserScope,
    ...topLevelScope,
    ...topLevelPermissions,
  ]);
  return Array.from(merged);
}

function toRoleContextName(role: string): string {
  const normalized = role.trim();
  if (!normalized) return 'Role';
  if (isSuperRole(normalized)) return 'Super';
  if (normalized.toLowerCase() === 'citizen') return 'Citizen';
  return normalized
    .split(/[_\s-]+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join(' ');
}

function toRoleContextId(role: string): string {
  const lower = role.trim().toLowerCase();
  if (isSuperRole(lower)) return 'app:super';
  if (lower === 'citizen') return 'app:citizen';
  return `app:role:${lower}`;
}

function ensureRoleContexts(baseContexts: AppContext[], roles: string[]): AppContext[] {
  const byId = new Map(baseContexts.map((ctx) => [ctx.id, ctx] as const));
  const withRoles = [...baseContexts];
  const uniqueRoles = Array.from(new Set(roles.map((role) => role.trim()).filter(Boolean)));

  for (const role of uniqueRoles) {
    const contextId = toRoleContextId(role);
    if (byId.has(contextId)) continue;

    withRoles.push({
      id: contextId,
      type: 'platform',
      name: toRoleContextName(role),
      subtitle: 'App Role',
      themeScopeType: 'platform',
      themeScopeId: null,
      permissions: contextId === 'app:super' ? ['*'] : contextId === 'app:citizen' ? [] : [],
    });
    byId.set(contextId, withRoles[withRoles.length - 1]);
  }

  return withRoles;
}

function collectAppPermissions(source: Record<string, unknown>): string[] {
  const userRecord =
    source.user && typeof source.user === 'object'
      ? (source.user as Record<string, unknown>)
      : null;

  const fromTopLevel = normalizePermissionList(source.appPermissions ?? source.permissions);
  const fromScope = normalizePermissionList(source.scope);
  const fromUserScope = normalizePermissionList(userRecord?.scope);
  const rbacScope = resolveRbacScopeRecord(source);
  const fromRbacApp = normalizePermissionList(rbacScope?.appScopePermissions);

  const merged = new Set<string>([
    ...fromTopLevel,
    ...fromScope,
    ...fromUserScope,
    ...fromRbacApp,
  ]);

  return Array.from(merged);
}

export function toUserProfile(payload: Record<string, unknown>): UserProfile {
  const rawUser = (payload.user as Record<string, unknown> | undefined) ?? payload;
  const firstName = rawUser.firstName ? String(rawUser.firstName) : rawUser.first_name ? String(rawUser.first_name) : '';
  const lastName = rawUser.lastName ? String(rawUser.lastName) : rawUser.last_name ? String(rawUser.last_name) : '';
  const fullNameFromParts = [firstName, lastName].filter(Boolean).join(' ').trim();
  const fallbackName = String(rawUser.fullName ?? rawUser.name ?? rawUser.displayName ?? '').trim();
  return {
    id: String(rawUser.id ?? rawUser.userId ?? rawUser.sub ?? payload.sub ?? ''),
    nin: rawUser.nin ? String(rawUser.nin) : undefined,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    otherName: rawUser.otherName ? String(rawUser.otherName) : undefined,
    dob: rawUser.dob ? String(rawUser.dob) : undefined,
    nationality: rawUser.nationality ? String(rawUser.nationality) : undefined,
    stateOfOrigin: rawUser.stateOfOrigin ? String(rawUser.stateOfOrigin) : undefined,
    localGovernment: rawUser.localGovernment ? String(rawUser.localGovernment) : undefined,
    fullName: fullNameFromParts || fallbackName || 'User',
    email: String(rawUser.email ?? ''),
    phone: rawUser.phone ? String(rawUser.phone) : undefined,
    roles: collectRoles(payload, rawUser),
    requiresPasswordChange: Boolean(rawUser.requiresPasswordChange ?? payload.requiresPasswordChange),
  };
}

export function toContexts(payload: Record<string, unknown>): AppContext[] {
  const contextsRaw = payload.availableContexts;
  if (!Array.isArray(contextsRaw)) return [];

  return contextsRaw.map((item, index) => {
    const context = item as Record<string, unknown>;
    const type = String(context.type ?? context.scopeType ?? 'public') as AppContext['type'];
    const themeScopeType = String(context.themeScopeType ?? (type === 'public' ? 'platform' : type)) as ThemeScopeType;
    const contextId = String(context.id ?? context.contextId ?? `ctx-${index}`);
    const contextRoleName = context.roleName ? String(context.roleName) : undefined;
    const orgIdFromPattern = type === 'organization' && contextId.startsWith('org:')
      ? contextId.split(':')[1] || ''
      : '';
    const organizationId = context.organizationId
      ? String(context.organizationId)
      : (type === 'organization' ? orgIdFromPattern || contextId : undefined);
    const branchId = context.branchId ? String(context.branchId) : undefined;
    return {
      id: contextId,
      type,
      name: String(context.name ?? context.label ?? 'Context'),
      subtitle: context.subtitle ? String(context.subtitle) : undefined,
      roleName: contextRoleName || undefined,
      logoUrl: context.logoUrl ? String(context.logoUrl) : undefined,
      themeScopeType,
      themeScopeId: context.themeScopeId ? String(context.themeScopeId) : null,
      permissions: normalizePermissionList(context.permissions),
      organizationId,
      branchId,
    };
  });
}

export function toIdentityResponse(payload: unknown): IdentityResponse {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const user = toUserProfile(source);
  const roles = user.roles;
  const rawUser = source.user && typeof source.user === 'object'
    ? (source.user as Record<string, unknown>)
    : source;
  const appLevelRoles = collectAppLevelRoles(source, rawUser);
  const rawContexts = toContexts(source).filter(
    (ctx) => !(ctx.type === 'public' || ctx.name.toLowerCase() === 'nhrs public'),
  );
  const defaultContextObj =
    source.defaultContext && typeof source.defaultContext === 'object'
      ? (source.defaultContext as Record<string, unknown>)
      : null;
  const isGlobalAdmin = roles.some(isSuperRole);
  const basePermissions = collectAppPermissions(source);
  const citizenPermissions = isGlobalAdmin ? [] : getCitizenOnlyPermissions(source, rawUser);
  const withAppContexts = ensureAppLevelContexts(rawContexts, isGlobalAdmin, citizenPermissions);
  const availableContexts = ensureRoleContexts(withAppContexts, appLevelRoles);
  const defaultContextId =
    isGlobalAdmin
      ? 'app:super'
      : source.defaultContextId
        ? String(source.defaultContextId)
        : defaultContextObj?.id
          ? String(defaultContextObj.id)
          : 'app:citizen';
  const permissions = isGlobalAdmin
    ? ['*']
    : collectAppPermissions(source);
  const orgPermissionSource = Array.isArray(source.orgPermissions)
    ? source.orgPermissions
    : Array.isArray(resolveRbacScopeRecord(source)?.orgScopePermissions)
      ? resolveRbacScopeRecord(source)?.orgScopePermissions
      : [];

  return {
    user,
    roles,
    permissions,
    appPermissions: permissions,
    orgPermissions: Array.isArray(orgPermissionSource)
      ? orgPermissionSource
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry) => ({
            organizationId: String(entry.organizationId ?? ''),
            permissions: normalizePermissionList(entry.permissions),
            roles: normalizeRoleList(entry.roles),
          }))
          .filter((entry) => entry.organizationId)
      : [],
    availableContexts,
    defaultContextId,
  };
}
