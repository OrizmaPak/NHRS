import type { AppContext, IdentityResponse, UserProfile } from '@/types/auth';

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
      permissions: Array.isArray(context.permissions)
        ? context.permissions.map((permission) => String(permission))
        : [],
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
  const userRecord =
    source.user && typeof source.user === 'object'
      ? (source.user as Record<string, unknown>)
      : null;
  const roles = user.roles;
  const permissions = Array.isArray(source.permissions)
    ? source.permissions.map((permission) => String(permission))
    : availableContexts.find((context) => context.id === defaultContextId)?.permissions ??
      (Array.isArray(userRecord?.scope)
        ? userRecord.scope.map((scope) => String(scope))
        : []);

  return {
    user,
    roles,
    permissions,
    availableContexts,
    defaultContextId,
  };
}
