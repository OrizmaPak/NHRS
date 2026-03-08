import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, ApiClientError } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { queryClient } from '@/app/providers/queryClient';
import { ALLOW_CONTEXT_SWITCH_FALLBACK } from '@/lib/constants';
import { interfacePermissions } from '@/lib/interfacePermissions';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore, type EffectivePermission } from '@/stores/permissionsStore';
import { useThemeStore } from '@/stores/themeStore';

type UserAccessPayload = {
  assignment?: { roleIds?: unknown[] } | null;
  roles?: unknown[];
  overrides?: unknown[];
};

type AppRolePayload = {
  _id?: unknown;
  id?: unknown;
  roleId?: unknown;
  name?: unknown;
  permissions?: unknown[];
};

type AppPermissionPayload = {
  _id?: unknown;
  id?: unknown;
  permissionId?: unknown;
  key?: unknown;
  permissionKey?: unknown;
  name?: unknown;
};

type PermissionRule = {
  permissionKey: string;
  effect: 'allow' | 'deny';
};

let cachedAppRoles: AppRolePayload[] = [];
let cachedAppPermissionKeys: string[] = [];
let cachedPermissionIdToKey: Record<string, string> = {};

function toEffectiveEntries(
  permissions: string[],
  overrides: Record<string, 'allow' | 'deny'>,
): EffectivePermission[] {
  return [
    ...permissions.map((key) => ({
      key,
      source: (overrides[key] === 'allow' ? 'override_allow' : 'role') as const,
      granted: true,
    })),
    ...Object.entries(overrides)
      .filter(([, effect]) => effect === 'deny')
      .map(([key]) => ({
        key,
        source: 'override_deny' as const,
        granted: false,
      })),
  ];
}

function normalizePermissionKey(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  const row = entry as Record<string, unknown>;
  return String(row.permissionKey ?? row.key ?? row.permission ?? row.name ?? '');
}

function normalizeRoleId(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (!raw || typeof raw !== 'object') return '';
  const row = raw as Record<string, unknown>;
  return String(row.$oid ?? row.id ?? row.oid ?? '');
}

function normalizeObjectId(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (!raw || typeof raw !== 'object') return '';
  const row = raw as Record<string, unknown>;
  if (typeof row.$oid === 'string') return row.$oid;
  if (typeof row.oid === 'string') return row.oid;
  if (typeof row.id === 'string') return row.id;
  if (typeof row.toString === 'function') {
    const asString = String(row.toString());
    if (asString && asString !== '[object Object]') return asString;
  }
  return '';
}

function normalizeEffect(raw: unknown): 'allow' | 'deny' {
  return String(raw ?? 'allow').toLowerCase() === 'deny' ? 'deny' : 'allow';
}

function toPermissionRule(
  entry: unknown,
  permissionLookup: Record<string, string> = {},
): PermissionRule | null {
  let permissionKey = normalizePermissionKey(entry);
  if (typeof entry === 'string') {
    if (!permissionKey) return null;
    return { permissionKey, effect: 'allow' };
  }
  const row = entry as Record<string, unknown>;
  if (!permissionKey) {
    const permissionId = normalizeObjectId(row.permissionId ?? row.permission_id ?? row.permissionRef);
    if (permissionId && permissionLookup[permissionId]) {
      permissionKey = permissionLookup[permissionId];
    }
  }
  if (!permissionKey) return null;
  return { permissionKey, effect: normalizeEffect(row.effect ?? row.value) };
}

function matchesPermission(ruleKey: string, permissionKey: string): boolean {
  if (ruleKey === '*') return true;
  if (ruleKey.endsWith('.*')) return permissionKey.startsWith(ruleKey.slice(0, -1));
  return ruleKey === permissionKey;
}

function specificity(ruleKey: string): number {
  if (ruleKey === '*') return 0;
  if (ruleKey.endsWith('.*')) return ruleKey.length - 1;
  return 1000 + ruleKey.length;
}

function evaluatePermission(permissionKey: string, roleRules: PermissionRule[], overrideRules: PermissionRule[]): boolean {
  const matchedRoleRules = roleRules
    .filter((rule) => matchesPermission(rule.permissionKey, permissionKey))
    .sort((a, b) => specificity(b.permissionKey) - specificity(a.permissionKey));
  const matchedOverrideRules = overrideRules
    .filter((rule) => matchesPermission(rule.permissionKey, permissionKey))
    .sort((a, b) => specificity(b.permissionKey) - specificity(a.permissionKey));

  let effect: 'allow' | 'deny' = 'deny';
  if (matchedRoleRules.length > 0) {
    effect = matchedRoleRules[0].effect;
  }
  if (matchedOverrideRules.length > 0) {
    effect = matchedOverrideRules[0].effect;
  }
  return effect === 'allow';
}

function contextRoleName(contextId: string, contextName: string): string | null {
  if (contextId === 'app:super') return 'super';
  if (contextId === 'app:citizen') return 'citizen';
  if (contextId.startsWith('app:role:')) return contextId.replace('app:role:', '').trim().toLowerCase();
  return contextName.trim().toLowerCase() || null;
}

function roleMatchesTarget(roleName: string, targetRole: string): boolean {
  const normalizedRole = roleName.trim().toLowerCase();
  const normalizedTarget = targetRole.trim().toLowerCase();
  if (!normalizedRole || !normalizedTarget) return false;
  if (normalizedRole === normalizedTarget) return true;
  if (normalizedTarget === 'citizen') {
    return normalizedRole === 'citizen' || normalizedRole.includes('citizen');
  }
  return false;
}

function isSuperContext(contextId: string, contextName: string): boolean {
  const id = contextId.trim().toLowerCase();
  const name = contextName.trim().toLowerCase();
  if (id === 'app:super') return true;
  if (id.startsWith('app:role:')) {
    const role = id.replace('app:role:', '');
    if (['super', 'superadmin', 'super_admin', 'platform_admin', 'app_admin', 'admin'].includes(role)) return true;
  }
  return ['super', 'superadmin', 'super admin', 'platform admin', 'app admin', 'admin'].includes(name);
}

export async function resolveSyntheticContextPermissions(userId: string, contextId: string, contextName: string): Promise<{
  permissions: string[];
  overrides: Record<string, 'allow' | 'deny'>;
}> {
  if (isSuperContext(contextId, contextName)) {
    return { permissions: ['*'], overrides: {} };
  }

  const accessResponse = await apiClient.get<UserAccessPayload>(endpoints.rbac.userAccess(userId));

  let roles: AppRolePayload[] = cachedAppRoles;
  const fallbackAccessRoles = Array.isArray(accessResponse.roles) ? (accessResponse.roles as AppRolePayload[]) : [];
  try {
    const rolesResponse = await apiClient.get<{ roles?: AppRolePayload[] }>(endpoints.rbac.appRoles);
    roles = Array.isArray(rolesResponse.roles) ? rolesResponse.roles : [];
    if (roles.length > 0) {
      cachedAppRoles = roles;
    }
  } catch {
    if (roles.length === 0) {
      // No role catalog available; fallback to overrides-only behavior.
      roles = fallbackAccessRoles.length > 0 ? fallbackAccessRoles : [];
    }
  }

  let appPermissionKeys = cachedAppPermissionKeys;
  let permissionIdToKey = { ...cachedPermissionIdToKey };
  try {
    const permissionsResponse = await apiClient.get<{ permissions?: AppPermissionPayload[] }>(endpoints.rbac.appPermissions);
    const permissionEntries = Array.isArray(permissionsResponse.permissions) ? permissionsResponse.permissions : [];
    const keys = permissionEntries.map((entry) => normalizePermissionKey(entry)).filter(Boolean);
    const mapping: Record<string, string> = {};
    for (const entry of permissionEntries) {
      const key = normalizePermissionKey(entry);
      const id = normalizeObjectId(entry._id ?? entry.id ?? entry.permissionId);
      if (id && key) mapping[id] = key;
    }
    if (keys.length > 0) {
      appPermissionKeys = Array.from(new Set(keys));
      cachedAppPermissionKeys = appPermissionKeys;
    }
    if (Object.keys(mapping).length > 0) {
      permissionIdToKey = mapping;
      cachedPermissionIdToKey = mapping;
    }
  } catch {
    // Keep cached permission universe if endpoint is unavailable in this context.
  }

  const assignedRoleIds = new Set(
    (Array.isArray(accessResponse.assignment?.roleIds) ? accessResponse.assignment?.roleIds : [])
      .map((value) => normalizeRoleId(value))
      .filter(Boolean),
  );

  const targetRole = contextRoleName(contextId, contextName);
  const matchedRoles = roles.filter((role) => {
    const roleName = String(role.name ?? '').trim().toLowerCase();
    if (!targetRole || !roleName || !roleMatchesTarget(roleName, targetRole)) return false;
    // Role contexts should resolve by role name first so context-switch stays predictable.
    // If assignment IDs exist but don't include this role, we still allow the explicit role-context view.
    const roleId = normalizeRoleId(role._id ?? role.id ?? role.roleId);
    if (!roleId) return true;
    if (assignedRoleIds.size === 0) return true;
    return assignedRoleIds.has(roleId) || roleMatchesTarget(roleName, targetRole);
  });

  const roleRules: PermissionRule[] = [];
  for (const role of matchedRoles) {
    const permissions = Array.isArray(role.permissions) ? role.permissions : [];
    for (const rule of permissions
      .map((entry) => toPermissionRule(entry, permissionIdToKey))
      .filter((entry): entry is PermissionRule => Boolean(entry))) {
      roleRules.push(rule);
    }
  }

  const overrideRules: PermissionRule[] = [];
  const overrides: Record<string, 'allow' | 'deny'> = {};
  const overrideList = Array.isArray(accessResponse.overrides) ? accessResponse.overrides : [];
  for (const raw of overrideList) {
    const rule = toPermissionRule(raw, permissionIdToKey);
    if (!rule) continue;
    overrideRules.push(rule);
    overrides[rule.permissionKey] = rule.effect;
  }

  const universe = new Set<string>([
    ...appPermissionKeys,
    ...interfacePermissions.map((entry) => entry.key),
    ...roleRules.map((rule) => rule.permissionKey),
    ...overrideRules.map((rule) => rule.permissionKey),
  ]);

  const resolvedPermissions = Array.from(universe).filter((permissionKey) =>
    evaluatePermission(permissionKey, roleRules, overrideRules),
  );

  if (roleRules.some((rule) => rule.permissionKey === '*') && resolvedPermissions.length === 0) {
    return { permissions: ['*'], overrides };
  }

  return { permissions: resolvedPermissions, overrides };
}

export function useSwitchContext() {
  const switchContext = useContextStore((state) => state.switchContext);
  const availableContexts = useContextStore((state) => state.availableContexts);
  const loadTheme = useThemeStore((state) => state.loadTheme);
  const setOverrides = usePermissionsStore((state) => state.setOverrides);
  const setEffectivePermissions = usePermissionsStore((state) => state.setEffectivePermissions);

  return useMutation({
    mutationFn: async (contextId: string) => {
      const candidate = availableContexts.find((entry) => entry.id === contextId) ?? null;
      if (!candidate) {
        throw new Error('Context not found');
      }

      const isSyntheticAppContext = candidate.id.startsWith('app:');

      if (!isSyntheticAppContext) {
        try {
          await apiClient.post(endpoints.identity.switchContext, { type: candidate.type, id: candidate.id });
        } catch (error) {
          const isNotFound = error instanceof ApiClientError && error.status === 404;
          if (!isNotFound || !ALLOW_CONTEXT_SWITCH_FALLBACK) {
            throw error;
          }
        }
      }

      const next = switchContext(contextId);
      if (!next) throw new Error('Context not found after switch');

      const userId = useAuthStore.getState().user?.id ? String(useAuthStore.getState().user?.id) : '';
      if (next.id.startsWith('app:') && userId) {
        try {
          const resolved = await resolveSyntheticContextPermissions(userId, next.id, next.name);
          setOverrides(resolved.overrides);
          setEffectivePermissions(toEffectiveEntries(resolved.permissions, resolved.overrides));
        } catch {
          const fallbackPermissions = Array.isArray(next.permissions) ? next.permissions : [];
          setOverrides({});
          setEffectivePermissions(toEffectiveEntries(fallbackPermissions, {}));
        }
      } else {
        const scopedPermissions = Array.isArray(next.permissions) ? next.permissions : [];
        setOverrides({});
        setEffectivePermissions(toEffectiveEntries(scopedPermissions, {}));
      }

      await loadTheme(next.themeScopeType, next.themeScopeId);
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = Array.isArray(query.queryKey) ? query.queryKey : [];
          const isIdentityMe = key[0] === 'identity' && key[1] === 'me';
          const isIdentityContexts = key[0] === 'identity' && key[1] === 'contexts';
          return !isIdentityMe && !isIdentityContexts;
        },
      });

      return next;
    },
    onSuccess: (context) => {
      toast.success(`Switched to ${context.name}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Unable to switch context');
    },
  });
}
