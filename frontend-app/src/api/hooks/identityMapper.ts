import type { AppContext, IdentityResponse, UserProfile } from '@/types/auth';

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

function collectPermissions(source: Record<string, unknown>, defaultContextId: string | undefined, availableContexts: AppContext[]): string[] {
  const userRecord =
    source.user && typeof source.user === 'object'
      ? (source.user as Record<string, unknown>)
      : null;

  const fromTopLevel = normalizePermissionList(source.permissions);
  const fromScope = normalizePermissionList(source.scope);
  const fromUserScope = normalizePermissionList(userRecord?.scope);

  const rbacScope =
    source.rbacScope && typeof source.rbacScope === 'object'
      ? (source.rbacScope as Record<string, unknown>)
      : null;
  const fromRbacApp = normalizePermissionList(rbacScope?.appScopePermissions);
  const fromRbacOrg = Array.isArray(rbacScope?.orgScopePermissions)
    ? (rbacScope?.orgScopePermissions as Array<Record<string, unknown>>).flatMap((item) =>
        normalizePermissionList(item.permissions),
      )
    : [];

  const fromDefaultContext = availableContexts.find((context) => context.id === defaultContextId)?.permissions ?? [];

  const merged = new Set<string>([
    ...fromTopLevel,
    ...fromScope,
    ...fromUserScope,
    ...fromRbacApp,
    ...fromRbacOrg,
    ...fromDefaultContext,
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
    id: String(rawUser.id ?? rawUser.userId ?? ''),
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    fullName: fullNameFromParts || fallbackName || 'User',
    email: String(rawUser.email ?? ''),
    phone: rawUser.phone ? String(rawUser.phone) : undefined,
    roles: Array.isArray(payload.roles)
      ? payload.roles.map((role) => String(role))
      : Array.isArray(rawUser.roles)
        ? rawUser.roles.map((role) => String(role))
        : [],
  };
}

export function toContexts(payload: Record<string, unknown>): AppContext[] {
  const contextsRaw = payload.availableContexts;
  if (!Array.isArray(contextsRaw)) return [];

  return contextsRaw.map((item, index) => {
    const context = item as Record<string, unknown>;
    return {
      id: String(context.id ?? context.contextId ?? `ctx-${index}`),
      type: String(context.type ?? context.scopeType ?? 'platform') as AppContext['type'],
      name: String(context.name ?? context.label ?? 'Context'),
      subtitle: context.subtitle ? String(context.subtitle) : undefined,
      logoUrl: context.logoUrl ? String(context.logoUrl) : undefined,
      themeScopeType: String(context.themeScopeType ?? context.type ?? 'platform') as AppContext['themeScopeType'],
      themeScopeId: context.themeScopeId ? String(context.themeScopeId) : null,
      permissions: normalizePermissionList(context.permissions),
    };
  });
}

export function toIdentityResponse(payload: unknown): IdentityResponse {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const user = toUserProfile(source);
  const availableContexts = toContexts(source);
  const defaultContextObj =
    source.defaultContext && typeof source.defaultContext === 'object'
      ? (source.defaultContext as Record<string, unknown>)
      : null;
  const defaultContextId =
    source.defaultContextId
      ? String(source.defaultContextId)
      : defaultContextObj?.id
        ? String(defaultContextObj.id)
        : availableContexts[0]?.id;
  const roles = user.roles;
  const isGlobalAdmin = roles.some((role) =>
    ['superadmin', 'super_admin', 'platform_admin', 'app_admin', 'admin'].includes(role.toLowerCase()),
  );
  const permissions = isGlobalAdmin
    ? ['*']
    : collectPermissions(source, defaultContextId, availableContexts);

  return {
    user,
    roles,
    permissions,
    availableContexts,
    defaultContextId,
  };
}
