import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { interfacePermissions } from '@/lib/interfacePermissions';

export type PermissionScope = 'app' | 'organization';

export type PermissionRow = {
  key: string;
  module: string;
  description: string;
  scope: PermissionScope;
  createdAt: string;
  interfaceLabel?: string;
  interfaceRoute?: string;
};

export type RoleRow = {
  id: string;
  name: string;
  description: string;
  scope: PermissionScope;
  permissions: string[];
  createdAt: string;
};

export type UserAccessData = {
  userId: string;
  userName: string;
  roles: string[];
  roleIds: string[];
  overrides: Array<{ key: string; effect: 'allow' | 'deny' }>;
  effectivePermissions: Array<{ key: string; source: 'role' | 'override_allow' | 'override_deny'; granted: boolean }>;
};

const fallbackPermissions: PermissionRow[] = [
  { key: 'records.read', module: 'records', description: 'Read patient records', scope: 'app', createdAt: new Date().toISOString() },
  { key: 'records.create', module: 'records', description: 'Create patient records', scope: 'app', createdAt: new Date().toISOString() },
  { key: 'governance.case.read', module: 'governance', description: 'View governance cases', scope: 'app', createdAt: new Date().toISOString() },
];

const fallbackRoles: RoleRow[] = [
  { id: 'role-super', name: 'super', description: 'Super access role', scope: 'app', permissions: ['*'], createdAt: new Date().toISOString() },
  { id: 'role-citizen', name: 'citizen', description: 'Citizen default role', scope: 'app', permissions: [], createdAt: new Date().toISOString() },
  { id: 'role-admin', name: 'app_admin', description: 'Platform administrator', scope: 'app', permissions: ['*'], createdAt: new Date().toISOString() },
  { id: 'role-provider', name: 'org_staff', description: 'Clinical provider role', scope: 'app', permissions: ['records.read', 'records.create'], createdAt: new Date().toISOString() },
];

export type UserSearchResult = {
  id: string;
  displayName: string;
  nin?: string;
  email?: string;
  phone?: string;
};

function asRecords(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
}

function asStringId(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (!raw || typeof raw !== 'object') return '';
  const obj = raw as Record<string, unknown>;
  if (typeof obj.$oid === 'string') return obj.$oid;
  if (typeof obj.oid === 'string') return obj.oid;
  if (typeof obj.id === 'string') return obj.id;
  return '';
}

function toRulePermissionKey(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return '';
  const obj = raw as Record<string, unknown>;
  return String(obj.permissionKey ?? obj.key ?? '');
}

function toPermissionRows(raw: unknown, scope: PermissionScope): PermissionRow[] {
  const rows = asRecords(raw)
    .map((item) => ({
      key: String(item.key ?? item.permissionKey ?? item.name ?? ''),
      module: String(item.module ?? 'general'),
      description: String(item.description ?? item.name ?? ''),
      scope,
      createdAt: String(item.createdAt ?? new Date().toISOString()),
    }))
    .filter((item) => item.key);

  const byKey = new Map(rows.map((row) => [row.key, row] as const));
  for (const entry of interfacePermissions) {
    if (!byKey.has(entry.key)) {
      const seeded: PermissionRow = {
        key: entry.key,
        module: entry.module,
        description: entry.description,
        scope,
        createdAt: new Date().toISOString(),
        interfaceLabel: entry.interfaceLabel,
        interfaceRoute: entry.route,
      };
      rows.push(seeded);
      byKey.set(entry.key, seeded);
      continue;
    }
    const existing = byKey.get(entry.key)!;
    if (!existing.interfaceLabel) existing.interfaceLabel = entry.interfaceLabel;
    if (!existing.interfaceRoute) existing.interfaceRoute = entry.route;
  }

  return rows;
}

function toRoleRows(raw: unknown, scope: PermissionScope): RoleRow[] {
  return asRecords(raw).map((item) => {
    const permissionsRaw = Array.isArray(item.permissions) ? item.permissions : [];
    const permissions = permissionsRaw.map(toRulePermissionKey).filter(Boolean);
    const fromUnderscoreId = asStringId(item._id);
    const fromId = asStringId(item.id);
    const fromRoleId = asStringId(item.roleId);
    const resolvedId = fromUnderscoreId || fromId || fromRoleId || crypto.randomUUID();
    return {
      id: resolvedId,
      name: String(item.name ?? 'role'),
      description: String(item.description ?? ''),
      scope,
      permissions,
      createdAt: String(item.createdAt ?? new Date().toISOString()),
    };
  });
}

function toEffectivePermissions(raw: unknown): Array<{ key: string; source: 'role' | 'override_allow' | 'override_deny'; granted: boolean }> {
  return asRecords(raw)
    .map((entry) => {
      const key = String(entry.key ?? entry.permissionKey ?? '');
      const sourceRaw = String(entry.source ?? 'role').toLowerCase();
      const effect = String(entry.effect ?? '').toLowerCase();
      const source: 'role' | 'override_allow' | 'override_deny' =
        sourceRaw === 'override'
          ? (effect === 'deny' ? 'override_deny' : 'override_allow')
          : (sourceRaw === 'override_deny' ? 'override_deny' : sourceRaw === 'override_allow' ? 'override_allow' : 'role');
      const granted = Object.prototype.hasOwnProperty.call(entry, 'granted')
        ? Boolean(entry.granted)
        : effect === 'allow' || source === 'role';
      return { key, source, granted };
    })
    .filter((entry) => entry.key);
}

function toOverrideRules(raw: unknown): Array<{ permissionKey: string; effect: 'allow' | 'deny' }> {
  return asRecords(raw)
    .map((entry) => {
      const permissionKey = String(entry.permissionKey ?? entry.key ?? '');
      const effect: 'allow' | 'deny' = String(entry.effect ?? entry.value ?? 'allow') === 'deny' ? 'deny' : 'allow';
      return { permissionKey, effect };
    })
    .filter((entry) => entry.permissionKey);
}

function toRoleRulePayload(keys: string[]) {
  return keys.map((permissionKey) => ({ permissionKey, effect: 'allow' as const }));
}

async function fetchUserAccessForMutation(scope: PermissionScope, userId: string, organizationId?: string) {
  const path = scope === 'app'
    ? endpoints.rbac.userAccess(userId)
    : organizationId
      ? endpoints.rbac.orgUserAccess(organizationId, userId)
      : null;
  if (!path) {
    return { roleIds: [] as string[], overrides: [] as Array<{ permissionKey: string; effect: 'allow' | 'deny' }> };
  }
  const response = await apiClient.get<Record<string, unknown>>(path);
  const assignment = response.assignment && typeof response.assignment === 'object' ? (response.assignment as Record<string, unknown>) : null;
  const roleIds = Array.isArray(assignment?.roleIds)
    ? assignment.roleIds
        .map((item) => asStringId(item) || (typeof item === 'string' ? item : ''))
        .filter(Boolean)
    : [];
  const overrides = toOverrideRules(response.overrides);
  return { roleIds, overrides };
}

export function useAppPermissions() {
  return useQuery({
    queryKey: ['access', 'app', 'permissions'],
    queryFn: async () => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.rbac.appPermissions);
        const rows = toPermissionRows(response.permissions ?? response.items ?? response.data ?? [], 'app');
        return rows.length > 0 ? rows : fallbackPermissions;
      } catch {
        return fallbackPermissions;
      }
    },
  });
}

export function useSaveAppPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { key: string; module: string; description: string }) =>
      apiClient.post(endpoints.rbac.appPermissions, {
        key: payload.key,
        name: payload.key,
        module: payload.module,
        description: payload.description,
        actions: [],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'app', 'permissions'] });
    },
  });
}

export function useUpdateAppPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { key: string; module: string; description: string }) =>
      apiClient.post(endpoints.rbac.appPermissions, {
        key: payload.key,
        name: payload.key,
        module: payload.module,
        description: payload.description,
        actions: [],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'app', 'permissions'] });
    },
  });
}

export function useDeleteAppPermission() {
  return useMutation({
    mutationFn: async () => Promise.reject(new Error('App permission delete is not supported by backend contract')),
  });
}

export function useAppRoles() {
  return useQuery({
    queryKey: ['access', 'app', 'roles'],
    queryFn: async () => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.rbac.appRoles);
        const rows = toRoleRows(response.roles ?? response.items ?? response.data ?? [], 'app');
        return rows.length > 0 ? rows : fallbackRoles;
      } catch {
        return fallbackRoles;
      }
    },
  });
}

export function useSaveAppRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id?: string; name: string; description: string; permissions: string[] }) =>
      payload.id
        ? apiClient.patch(endpoints.rbac.appRoleById(payload.id), {
            name: payload.name,
            description: payload.description,
            permissions: toRoleRulePayload(payload.permissions),
          })
        : apiClient.post(endpoints.rbac.appRoles, {
            name: payload.name,
            description: payload.description,
            permissions: toRoleRulePayload(payload.permissions),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'app', 'roles'] });
    },
  });
}

export function useDeleteAppRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete(endpoints.rbac.appRoleById(id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'app', 'roles'] });
    },
  });
}

export function useUserAccess(userId: string, organizationId?: string) {
  return useQuery({
    queryKey: ['access', 'user', userId, organizationId ?? 'app'],
    enabled: Boolean(userId),
    queryFn: async (): Promise<UserAccessData> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(
          organizationId ? endpoints.rbac.orgUserAccess(organizationId, userId) : endpoints.rbac.userAccess(userId),
        );
        const roles = Array.isArray(response.roles)
          ? response.roles
              .map((entry) => {
                if (typeof entry === 'string') return entry;
                if (!entry || typeof entry !== 'object') return '';
                const row = entry as Record<string, unknown>;
                return String(row.name ?? row.roleName ?? row.id ?? '');
              })
              .filter(Boolean)
          : [];
        const assignment = response.assignment && typeof response.assignment === 'object' ? (response.assignment as Record<string, unknown>) : null;
        const roleIds = Array.isArray(assignment?.roleIds)
          ? assignment.roleIds
              .map((entry) => asStringId(entry) || (typeof entry === 'string' ? entry : ''))
              .filter(Boolean)
          : [];
        const overrides = toOverrideRules(response.overrides).map((entry) => ({
          key: entry.permissionKey,
          effect: entry.effect,
        }));

        return {
          userId,
          userName: String(response.userName ?? response.name ?? userId),
          roles,
          roleIds,
          overrides,
          effectivePermissions: toEffectivePermissions(response.effectivePermissions),
        };
      } catch {
        return {
          userId,
          userName: userId,
          roles: ['app_admin'],
          roleIds: [],
          overrides: [{ key: 'records.delete', effect: 'deny' }],
          effectivePermissions: [
            { key: 'records.read', source: 'role', granted: true },
            { key: 'records.create', source: 'role', granted: true },
            { key: 'records.delete', source: 'override_deny', granted: false },
          ],
        };
      }
    },
  });
}

export function useAssignUserRole(scope: PermissionScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { userId: string; roleId: string; organizationId?: string }) => {
      const current = await fetchUserAccessForMutation(scope, payload.userId, payload.organizationId);
      const nextRoleIds = Array.from(new Set([...current.roleIds, payload.roleId]));
      if (scope === 'app') {
        return apiClient.post(endpoints.rbac.appUserRoles(payload.userId), { roleIds: nextRoleIds });
      }
      if (!payload.organizationId) throw new Error('organizationId is required');
      return apiClient.post(endpoints.rbac.orgUserRoles(payload.organizationId, payload.userId), { roleIds: nextRoleIds });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'user', variables.userId] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'me'] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'contexts'] });
    },
  });
}

export function useRemoveUserRole(scope: PermissionScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { userId: string; roleId: string; organizationId?: string }) => {
      const current = await fetchUserAccessForMutation(scope, payload.userId, payload.organizationId);
      const nextRoleIds = current.roleIds.filter((id) => id !== payload.roleId);
      if (scope === 'app') {
        return apiClient.post(endpoints.rbac.appUserRoles(payload.userId), { roleIds: nextRoleIds });
      }
      if (!payload.organizationId) throw new Error('organizationId is required');
      return apiClient.post(endpoints.rbac.orgUserRoles(payload.organizationId, payload.userId), { roleIds: nextRoleIds });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'user', variables.userId] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'me'] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'contexts'] });
    },
  });
}

export function useUpsertUserOverride(scope: PermissionScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { userId: string; permissionKey: string; effect: 'allow' | 'deny'; organizationId?: string }) => {
      const current = await fetchUserAccessForMutation(scope, payload.userId, payload.organizationId);
      const withoutCurrent = current.overrides.filter((entry) => entry.permissionKey !== payload.permissionKey);
      const overrides = [...withoutCurrent, { permissionKey: payload.permissionKey, effect: payload.effect }];
      if (scope === 'app') {
        return apiClient.post(endpoints.rbac.appUserOverrides(payload.userId), { overrides });
      }
      if (!payload.organizationId) throw new Error('organizationId is required');
      return apiClient.post(endpoints.rbac.orgUserOverrides(payload.organizationId, payload.userId), { overrides });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'user', variables.userId] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'me'] });
    },
  });
}

export function useDeleteUserOverride(scope: PermissionScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { userId: string; permissionKey: string; organizationId?: string }) => {
      const current = await fetchUserAccessForMutation(scope, payload.userId, payload.organizationId);
      const overrides = current.overrides.filter((entry) => entry.permissionKey !== payload.permissionKey);
      if (scope === 'app') {
        return apiClient.post(endpoints.rbac.appUserOverrides(payload.userId), { overrides });
      }
      if (!payload.organizationId) throw new Error('organizationId is required');
      return apiClient.post(endpoints.rbac.orgUserOverrides(payload.organizationId, payload.userId), { overrides });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'user', variables.userId] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'me'] });
    },
  });
}

export function useReplaceUserRoles(scope: PermissionScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { userId: string; roleIds: string[]; organizationId?: string }) => {
      const uniqueRoleIds = Array.from(new Set(payload.roleIds.map((id) => String(id)).filter(Boolean)));
      if (scope === 'app') {
        return apiClient.post(endpoints.rbac.appUserRoles(payload.userId), { roleIds: uniqueRoleIds });
      }
      if (!payload.organizationId) throw new Error('organizationId is required');
      return apiClient.post(endpoints.rbac.orgUserRoles(payload.organizationId, payload.userId), { roleIds: uniqueRoleIds });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'user', variables.userId] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'me'] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'contexts'] });
    },
  });
}

export function useReplaceUserOverrides(scope: PermissionScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: { userId: string; overrides: Array<{ permissionKey: string; effect: 'allow' | 'deny' }>; organizationId?: string },
    ) => {
      if (scope === 'app') {
        return apiClient.post(endpoints.rbac.appUserOverrides(payload.userId), { overrides: payload.overrides });
      }
      if (!payload.organizationId) throw new Error('organizationId is required');
      return apiClient.post(endpoints.rbac.orgUserOverrides(payload.organizationId, payload.userId), { overrides: payload.overrides });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'user', variables.userId] });
      await queryClient.invalidateQueries({ queryKey: ['identity', 'me'] });
    },
  });
}

export function useUserSearch(term: string) {
  return useQuery({
    queryKey: ['access', 'user-search', term],
    enabled: term.trim().length >= 2,
    retry: false,
    staleTime: 10_000,
    queryFn: async (): Promise<UserSearchResult[]> => {
      const trimmed = term.trim();

      const normalizeItems = (items: unknown[]): UserSearchResult[] =>
        items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item, index) => {
            const id = String(item.id ?? item.userId ?? item._id ?? item.sub ?? item.nin ?? '');
            const firstName = String(item.firstName ?? item.first_name ?? '');
            const lastName = String(item.lastName ?? item.last_name ?? '');
            const displayName = String(
              item.displayName ??
                item.fullName ??
                item.name ??
                [firstName, lastName].filter(Boolean).join(' ') ??
                (item.nin ? `User ${String(item.nin)}` : `User ${index + 1}`),
            );
            return {
              id,
              displayName,
              nin: item.nin ? String(item.nin) : undefined,
              email: item.email ? String(item.email) : undefined,
              phone: item.phone ? String(item.phone) : undefined,
            } as UserSearchResult;
          })
          .filter((item) => Boolean(item.id));

      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.patientSearch, {
          query: { q: trimmed, page: 1, limit: 10 },
          suppressGlobalErrors: true,
        });
        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];
        const normalized = normalizeItems(items);
        if (normalized.length > 0) return normalized;
      } catch {
        // Continue to fallbacks below.
      }

      if (/^\d{11}$/.test(trimmed)) {
        try {
          const ninRecord = await apiClient.get<Record<string, unknown>>(`/nin/${trimmed}`, {
            suppressGlobalErrors: true,
            skipAuth: true,
          });
          const displayName = String(
            ninRecord.displayName ??
            ninRecord.fullName ??
            [ninRecord.firstName, ninRecord.lastName].filter(Boolean).join(' ') ??
            `User ${trimmed}`,
          );
          return [{
            id: String(ninRecord.userId ?? ninRecord.id ?? ninRecord._id ?? trimmed),
            displayName,
            nin: trimmed,
            email: ninRecord.email ? String(ninRecord.email) : undefined,
            phone: ninRecord.phone ? String(ninRecord.phone) : undefined,
          }];
        } catch {
          return [];
        }
      }

      return [];
    },
  });
}

export function useOrgPermissions(organizationId?: string) {
  return useQuery({
    queryKey: ['access', 'org', organizationId ?? 'none', 'permissions'],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      if (!organizationId) return [];
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.rbac.orgPermissions(organizationId));
        const rows = toPermissionRows(response.permissions ?? response.items ?? response.data ?? [], 'organization');
        return rows.length > 0 ? rows : fallbackPermissions.map((entry) => ({ ...entry, scope: 'organization' as const }));
      } catch {
        return fallbackPermissions.map((entry) => ({ ...entry, scope: 'organization' as const }));
      }
    },
  });
}

export function useSaveOrgPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { key: string; module: string; description: string; organizationId?: string }) => {
      if (!payload.organizationId) throw new Error('Active organization context is required');
      return apiClient.post(endpoints.rbac.orgPermissions(payload.organizationId), {
        key: payload.key,
        name: payload.key,
        module: payload.module,
        description: payload.description,
        actions: [],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'org'] });
    },
  });
}

export function useUpdateOrgPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { key: string; module: string; description: string; organizationId?: string }) => {
      if (!payload.organizationId) throw new Error('Active organization context is required');
      return apiClient.post(endpoints.rbac.orgPermissions(payload.organizationId), {
        key: payload.key,
        name: payload.key,
        module: payload.module,
        description: payload.description,
        actions: [],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'org'] });
    },
  });
}

export function useDeleteOrgPermission() {
  return useMutation({
    mutationFn: async () => Promise.reject(new Error('Organization permission delete is not supported by backend contract')),
  });
}

export function useOrgRoles(organizationId?: string) {
  return useQuery({
    queryKey: ['access', 'org', organizationId ?? 'none', 'roles'],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      if (!organizationId) return [];
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.rbac.orgRoles(organizationId));
        const rows = toRoleRows(response.roles ?? response.items ?? response.data ?? [], 'organization');
        return rows.length > 0 ? rows : fallbackRoles.map((entry) => ({ ...entry, scope: 'organization' as const }));
      } catch {
        return fallbackRoles.map((entry) => ({ ...entry, scope: 'organization' as const }));
      }
    },
  });
}

export function useSaveOrgRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id?: string; name: string; description: string; permissions: string[]; organizationId?: string }) => {
      if (!payload.organizationId) throw new Error('Active organization context is required');
      if (payload.id) {
        return apiClient.patch(endpoints.rbac.orgRoleById(payload.organizationId, payload.id), {
          name: payload.name,
          description: payload.description,
          permissions: toRoleRulePayload(payload.permissions),
        });
      }
      return apiClient.post(endpoints.rbac.orgRoles(payload.organizationId), {
        name: payload.name,
        description: payload.description,
        permissions: toRoleRulePayload(payload.permissions),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'org'] });
    },
  });
}

export function useDeleteOrgRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; organizationId?: string }) => {
      if (!payload.organizationId) throw new Error('Active organization context is required');
      return apiClient.delete(endpoints.rbac.orgRoleById(payload.organizationId, payload.id));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['access', 'org'] });
    },
  });
}
