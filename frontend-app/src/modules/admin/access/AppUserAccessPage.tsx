import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { SmartSelect } from '@/components/data/SmartSelect';
import { SearchInput } from '@/components/data/SearchInput';
import {
  useAppPermissions,
  useAppRoles,
  useReplaceUserOverrides,
  useReplaceUserRoles,
  useUserAccess,
  searchAccessUsers,
  type UserSearchResult,
} from '@/api/hooks/useAccessControl';
import { useAuthStore } from '@/stores/authStore';
import { findInterfacePermissions } from '@/lib/interfacePermissions';

type OverrideEffect = 'allow' | 'deny';
type ScopedOverrideRule = { permissionKey: string; effect: OverrideEffect; roleName?: string };
const ALL_ROLES_SCOPE = '__all__';

const isSuperRole = (roleName: string) => String(roleName || '').trim().toLowerCase() === 'super';

function looksLikeOpaqueIdentifier(value?: string | null) {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (/^[a-f0-9]{24}$/i.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) return true;
  if (/^[A-Za-z0-9_-]{18,}$/.test(v) && !/\s/.test(v)) return true;
  return false;
}

export function AppUserAccessPage() {
  const { userId = '' } = useParams();
  const authUser = useAuthStore((state) => state.user);
  const initialUserId = userId === 'self' ? String(authUser?.id ?? '') : userId;

  const [userLookup, setUserLookup] = useState<Record<string, UserSearchResult>>({});
  const [selectedUserValue, setSelectedUserValue] = useState<string | null>(initialUserId || null);
  const [selectedCandidate, setSelectedCandidate] = useState<UserSearchResult | null>(null);
  const [targetUserId, setTargetUserId] = useState(initialUserId || '');
  const [roleSearch, setRoleSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [manualRoleSelection, setManualRoleSelection] = useState<Set<string> | null>(null);
  const [manualOverrideRules, setManualOverrideRules] = useState<ScopedOverrideRule[] | null>(null);
  const [overrideRoleScope, setOverrideRoleScope] = useState<string | null>(null);

  const rolesQuery = useAppRoles();
  const permissionsQuery = useAppPermissions();
  const userAccessQuery = useUserAccess(targetUserId);
  const replaceRoles = useReplaceUserRoles('app');
  const replaceOverrides = useReplaceUserOverrides('app');

  const displayedCandidate = selectedCandidate ?? (targetUserId ? userLookup[targetUserId] ?? null : null);
  const apiReportedName = userAccessQuery.data?.userName?.trim() ?? '';
  const displayedName =
    displayedCandidate?.displayName ??
    (apiReportedName && !looksLikeOpaqueIdentifier(apiReportedName) ? apiReportedName : null) ??
    (initialUserId && authUser?.id === initialUserId ? authUser.fullName : null) ??
    'Loading...';
  const displayedNin = displayedCandidate?.nin ?? (initialUserId && authUser?.id === initialUserId ? authUser.nin : undefined) ?? 'Not available';

  const assignedRoleIds = useMemo(() => {
    if (!userAccessQuery.data) return new Set<string>();
    const explicitRoleIds = userAccessQuery.data.roleIds ?? [];
    if (explicitRoleIds.length > 0) {
      return new Set(explicitRoleIds);
    }
    const roleIdByName = new Map((rolesQuery.data ?? []).map((role) => [role.name.toLowerCase(), role.id] as const));
    const resolved = (userAccessQuery.data.roles ?? [])
      .map((name) => ({ name: String(name).toLowerCase(), id: roleIdByName.get(String(name).toLowerCase()) }))
      .filter((entry) => Boolean(entry.id) && !isSuperRole(entry.name))
      .map((entry) => String(entry.id));
    return new Set(resolved);
  }, [rolesQuery.data, userAccessQuery.data]);

  const selectedRoleIds = manualRoleSelection ?? assignedRoleIds;
  const roleRowsById = useMemo(() => new Map((rolesQuery.data ?? []).map((role) => [role.id, role] as const)), [rolesQuery.data]);

  const selectedRoleNames = useMemo(
    () =>
      Array.from(selectedRoleIds)
        .map((roleId) => roleRowsById.get(roleId)?.name?.trim().toLowerCase())
        .filter((name): name is string => Boolean(name) && !isSuperRole(name)),
    [roleRowsById, selectedRoleIds],
  );

  const assignedOverrideRules = useMemo(() => {
    return (userAccessQuery.data?.overrides ?? []).map((override) => ({
      permissionKey: override.key,
      effect: override.effect,
      roleName: override.roleName ? String(override.roleName).trim().toLowerCase() : undefined,
    }));
  }, [userAccessQuery.data?.overrides]);

  const overrideRules = manualOverrideRules ?? assignedOverrideRules;

  const resolvedOverrideRoleScope = useMemo(() => {
    if (overrideRoleScope && (overrideRoleScope === ALL_ROLES_SCOPE || selectedRoleNames.includes(overrideRoleScope))) {
      return overrideRoleScope;
    }
    if (selectedRoleNames.length > 0) return selectedRoleNames[0];
    return ALL_ROLES_SCOPE;
  }, [overrideRoleScope, selectedRoleNames]);

  const scopedOverrideMap = useMemo(() => {
    const mapped: Record<string, OverrideEffect> = {};
    for (const override of overrideRules) {
      const overrideRole = override.roleName ? String(override.roleName).trim().toLowerCase() : '';
      const isGlobalScope = resolvedOverrideRoleScope === ALL_ROLES_SCOPE;
      const matchesScope = isGlobalScope ? !overrideRole : overrideRole === resolvedOverrideRoleScope;
      if (!matchesScope) continue;
      mapped[override.permissionKey] = override.effect;
    }
    return mapped;
  }, [overrideRules, resolvedOverrideRoleScope]);

  const permissionRows = useMemo(() => {
    const rows = permissionsQuery.data ?? [];
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }, [permissionsQuery.data]);

  const filteredPermissionRows = useMemo(() => {
    const key = permissionSearch.trim().toLowerCase();
    if (!key) return permissionRows;
    return permissionRows.filter((permission) => {
      const interfaces = findInterfacePermissions(permission.key);
      const interfaceText = interfaces.map((entry) => `${entry.interfaceLabel} ${entry.route}`).join(' ');
      return `${permission.key} ${permission.description} ${interfaceText}`.toLowerCase().includes(key);
    });
  }, [permissionRows, permissionSearch]);

  const interfacePermissionRows = useMemo(
    () => filteredPermissionRows.filter((permission) => findInterfacePermissions(permission.key).length > 0),
    [filteredPermissionRows],
  );
  const otherPermissionRows = useMemo(
    () => filteredPermissionRows.filter((permission) => findInterfacePermissions(permission.key).length === 0),
    [filteredPermissionRows],
  );

  const rolePermissionsSet = useMemo(() => {
    const roleMap = new Map((rolesQuery.data ?? []).map((role) => [role.id, role] as const));
    const granted = new Set<string>();
    if (resolvedOverrideRoleScope === ALL_ROLES_SCOPE) {
      for (const roleId of selectedRoleIds) {
        for (const key of roleMap.get(roleId)?.permissions ?? []) granted.add(key);
      }
      return granted;
    }
    for (const roleId of selectedRoleIds) {
      const role = roleMap.get(roleId);
      if (!role) continue;
      if (String(role.name || '').trim().toLowerCase() !== resolvedOverrideRoleScope) continue;
      for (const key of role.permissions ?? []) granted.add(key);
    }
    return granted;
  }, [resolvedOverrideRoleScope, rolesQuery.data, selectedRoleIds]);

  const filteredRoles = useMemo(() => {
    const roles = (rolesQuery.data ?? []).filter((role) => !isSuperRole(role.name));
    const key = roleSearch.trim().toLowerCase();
    if (!key) return roles;
    return roles.filter((role) => `${role.name} ${role.description}`.toLowerCase().includes(key));
  }, [roleSearch, rolesQuery.data]);

  const effectivePermissionState = (permissionKey: string): 'allow' | 'deny' | 'inherit' => {
    if (scopedOverrideMap[permissionKey] === 'deny') return 'deny';
    if (scopedOverrideMap[permissionKey] === 'allow') return 'allow';
    if (rolePermissionsSet.has('*') || rolePermissionsSet.has(permissionKey)) return 'allow';
    return 'inherit';
  };

  const upsertScopedOverride = (permissionKey: string, effect?: OverrideEffect) => {
    const targetRole = resolvedOverrideRoleScope === ALL_ROLES_SCOPE ? '' : resolvedOverrideRoleScope;
    setManualOverrideRules((prev) => {
      const base = prev ?? [...overrideRules];
      const filtered = base.filter((entry) => {
        if (entry.permissionKey !== permissionKey) return true;
        const entryRole = entry.roleName ? String(entry.roleName).trim().toLowerCase() : '';
        return entryRole !== targetRole;
      });
      if (!effect) return filtered;
      if (targetRole) {
        return [...filtered, { permissionKey, effect, roleName: targetRole }];
      }
      return [...filtered, { permissionKey, effect }];
    });
  };

  const loadUserOptions = useCallback(async (term: string) => {
    const users = await searchAccessUsers(term);
    if (users.length > 0) {
      setUserLookup((prev) => {
        const next = { ...prev };
        users.forEach((user) => {
          next[user.id] = user;
        });
        return next;
      });
    }
    return users.map((user) => ({
      value: user.id,
      label: user.displayName,
      description: [user.nin, user.bvn ? `BVN:${user.bvn}` : undefined, user.email, user.phone].filter(Boolean).join(' | ') || user.id,
    }));
  }, []);

  if (userId === 'self' && !authUser?.id) {
    return <ErrorState title="Loading user context" description="Fetching your account context..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Access - App Scope"
        description="Search user by NIN/email/phone/name, assign rows (roles), and set interface can/cannot overrides."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Access Control' }, { label: 'User Access' }]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Find User</CardTitle>
            <CardDescription>Type NIN, BVN, email, phone, or name. Results filter live as you type.</CardDescription>
          </div>
        </CardHeader>
        <div className="w-full md:max-w-xl">
          <SmartSelect
            value={selectedUserValue}
            onChange={(value) => {
              setSelectedUserValue(value);
              const candidate = userLookup[value] ?? null;
              if (!candidate) {
                toast.error('Unable to resolve selected user. Please try again.');
                return;
              }
              setSelectedCandidate(candidate);
              setTargetUserId(candidate.id);
              setManualRoleSelection(null);
              setManualOverrideRules(null);
              setOverrideRoleScope(null);
            }}
            placeholder="Search by NIN, email, phone, or name"
            emptyLabel="No matching user found"
            loadOptions={loadUserOptions}
          />
        </div>
      </Card>

      {targetUserId ? (
        <>
          {userAccessQuery.isError ? (
            <ErrorState title="Unable to load user access" description="Please retry." onRetry={() => userAccessQuery.refetch()} />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>User Information</CardTitle>
                    <CardDescription>NIN: {displayedNin}</CardDescription>
                  </div>
                </CardHeader>
                <p className="text-sm text-foreground">Name: {displayedName}</p>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Rows (Roles)</CardTitle>
                    <CardDescription>Only assigned roles are preselected. Super is excluded from assignable options.</CardDescription>
                  </div>
                </CardHeader>
                <div className="mb-3 md:max-w-md">
                  <SearchInput value={roleSearch} onChange={setRoleSearch} placeholder="Search roles by name or description" />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {filteredRoles.map((role) => {
                    const checked = selectedRoleIds.has(role.id);
                    return (
                      <label key={role.id} className="flex items-center justify-between rounded border border-border p-2">
                        <span>
                          <span className="block text-sm font-medium text-foreground">{role.name}</span>
                          <span className="block text-xs text-muted">{role.description}</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setManualRoleSelection((prev) => {
                              const base = prev ?? new Set(selectedRoleIds);
                              const next = new Set(base);
                              if (event.target.checked) next.add(role.id);
                              else next.delete(role.id);
                              return next;
                            });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <Button
                    loading={replaceRoles.isPending}
                    loadingText="Saving rows..."
                    onClick={async () => {
                      await replaceRoles.mutateAsync({ userId: targetUserId, roleIds: Array.from(selectedRoleIds) });
                      setManualRoleSelection(null);
                      setManualOverrideRules(null);
                      toast.success('Rows updated');
                    }}
                  >
                    Save Rows
                  </Button>
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Interface Permissions (Can / Cannot)</CardTitle>
                    <CardDescription>
                      Cannot override takes precedence over row permissions. If Cannot is on, access is denied even if row allows.
                    </CardDescription>
                  </div>
                </CardHeader>
                <div className="mb-3 md:max-w-md">
                  <SearchInput value={permissionSearch} onChange={setPermissionSearch} placeholder="Search permissions, description, or interface" />
                </div>
                <div className="mb-3 md:max-w-sm">
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Specific Permission Scope</label>
                  <select
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                    value={resolvedOverrideRoleScope}
                    onChange={(event) => setOverrideRoleScope(event.target.value)}
                  >
                    <option value={ALL_ROLES_SCOPE}>All assigned rows (global override)</option>
                    {selectedRoleNames.map((roleName) => (
                      <option key={roleName} value={roleName}>
                        {roleName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-4">
                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold text-foreground">Interface Access Permissions</h4>
                    {interfacePermissionRows.map((permission) => {
                      const interfaces = findInterfacePermissions(permission.key);
                      const state = effectivePermissionState(permission.key);
                      return (
                        <div key={permission.key} className="rounded border border-border p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{permission.key}</p>
                            <Badge variant={state === 'deny' ? 'danger' : state === 'allow' ? 'success' : 'outline'}>
                              {state.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted">{permission.description}</p>
                          {interfaces.length > 0 ? (
                            <p className="mt-1 text-xs text-primary">
                              {interfaces[0].interfaceLabel} ({interfaces[0].route})
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant={scopedOverrideMap[permission.key] === 'allow' ? 'default' : 'outline'}
                              onClick={() => upsertScopedOverride(permission.key, scopedOverrideMap[permission.key] === 'allow' ? undefined : 'allow')}
                            >
                              Can
                            </Button>
                            <Button
                              size="sm"
                              variant={scopedOverrideMap[permission.key] === 'deny' ? 'danger' : 'outline'}
                              onClick={() => upsertScopedOverride(permission.key, scopedOverrideMap[permission.key] === 'deny' ? undefined : 'deny')}
                            >
                              Cannot
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => upsertScopedOverride(permission.key, undefined)}
                            >
                              Inherit
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </section>
                  {otherPermissionRows.length > 0 ? (
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold text-foreground">Other Action Permissions</h4>
                      {otherPermissionRows.map((permission) => {
                        const state = effectivePermissionState(permission.key);
                        return (
                          <div key={permission.key} className="rounded border border-border p-3">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{permission.key}</p>
                              <Badge variant={state === 'deny' ? 'danger' : state === 'allow' ? 'success' : 'outline'}>
                                {state.toUpperCase()}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted">{permission.description}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant={scopedOverrideMap[permission.key] === 'allow' ? 'default' : 'outline'}
                                onClick={() => upsertScopedOverride(permission.key, scopedOverrideMap[permission.key] === 'allow' ? undefined : 'allow')}
                              >
                                Can
                              </Button>
                              <Button
                                size="sm"
                                variant={scopedOverrideMap[permission.key] === 'deny' ? 'danger' : 'outline'}
                                onClick={() => upsertScopedOverride(permission.key, scopedOverrideMap[permission.key] === 'deny' ? undefined : 'deny')}
                              >
                                Cannot
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => upsertScopedOverride(permission.key, undefined)}
                              >
                                Inherit
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ) : null}
                  {interfacePermissionRows.length === 0 && otherPermissionRows.length === 0 ? (
                    <div className="rounded border border-border p-3 text-sm text-muted">No permissions matched your search.</div>
                  ) : null}
                </div>
                <div className="mt-3">
                  <Button
                    loading={replaceOverrides.isPending}
                    loadingText="Saving permissions..."
                    onClick={async () => {
                      const overrides = overrideRules
                        .filter((entry) => entry.permissionKey && (entry.effect === 'allow' || entry.effect === 'deny'))
                        .map((entry) =>
                          entry.roleName
                            ? { permissionKey: entry.permissionKey, effect: entry.effect, roleName: entry.roleName }
                            : { permissionKey: entry.permissionKey, effect: entry.effect });
                      await replaceOverrides.mutateAsync({ userId: targetUserId, overrides });
                      setManualOverrideRules(null);
                      toast.success('Interface permissions updated');
                    }}
                  >
                    Save Interface Permissions
                  </Button>
                </div>
              </Card>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
