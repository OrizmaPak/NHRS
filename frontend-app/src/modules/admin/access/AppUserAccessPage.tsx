import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/feedback/ErrorState';
import {
  useAppPermissions,
  useAppRoles,
  useReplaceUserOverrides,
  useReplaceUserRoles,
  useUserAccess,
  useUserSearch,
  type UserSearchResult,
} from '@/api/hooks/useAccessControl';
import { useAuthStore } from '@/stores/authStore';
import { findInterfacePermissions } from '@/lib/interfacePermissions';
import { useDebounce } from '@/hooks/useDebounce';

type OverrideEffect = 'allow' | 'deny';

export function AppUserAccessPage() {
  const { userId = '' } = useParams();
  const authUser = useAuthStore((state) => state.user);
  const initialUserId = userId === 'self' ? String(authUser?.id ?? '') : userId;

  const [searchInput, setSearchInput] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<UserSearchResult | null>(null);
  const [targetUserId, setTargetUserId] = useState(initialUserId || '');
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [overrideMap, setOverrideMap] = useState<Record<string, OverrideEffect>>({});

  const debouncedSearch = useDebounce(searchInput, 250);
  const searchQuery = useUserSearch(debouncedSearch);
  const rolesQuery = useAppRoles();
  const permissionsQuery = useAppPermissions();
  const userAccessQuery = useUserAccess(targetUserId);
  const replaceRoles = useReplaceUserRoles('app');
  const replaceOverrides = useReplaceUserOverrides('app');

  const candidates = searchQuery.data ?? [];

  useEffect(() => {
    if (!userAccessQuery.data) return;
    setSelectedRoleIds(new Set(userAccessQuery.data.roleIds));
    const mapped: Record<string, OverrideEffect> = {};
    for (const override of userAccessQuery.data.overrides) {
      mapped[override.key] = override.effect;
    }
    setOverrideMap(mapped);
  }, [userAccessQuery.data]);

  const permissionRows = useMemo(() => {
    const rows = permissionsQuery.data ?? [];
    return rows
      .filter((permission) => findInterfacePermissions(permission.key).length > 0)
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [permissionsQuery.data]);

  const rolePermissionsSet = useMemo(() => {
    const roleMap = new Map((rolesQuery.data ?? []).map((role) => [role.id, role.permissions] as const));
    const granted = new Set<string>();
    for (const roleId of selectedRoleIds) {
      for (const key of roleMap.get(roleId) ?? []) granted.add(key);
    }
    return granted;
  }, [rolesQuery.data, selectedRoleIds]);

  const effectivePermissionState = (permissionKey: string): 'allow' | 'deny' | 'inherit' => {
    if (overrideMap[permissionKey] === 'deny') return 'deny';
    if (overrideMap[permissionKey] === 'allow') return 'allow';
    if (rolePermissionsSet.has('*') || rolePermissionsSet.has(permissionKey)) return 'allow';
    return 'inherit';
  };

  const onSearchSubmit = () => {
    const trimmed = searchInput.trim().toLowerCase();
    if (!trimmed) return;

    const bestMatch =
      selectedCandidate ??
      candidates.find((entry) =>
        [entry.displayName, entry.nin ?? '', entry.email ?? '', entry.phone ?? '']
          .join(' ')
          .toLowerCase()
          .includes(trimmed),
      ) ??
      null;

    if (!bestMatch?.id) {
      toast.error('Select a user from suggestions first.');
      return;
    }

    setTargetUserId(bestMatch.id);
    setSelectedCandidate(bestMatch);
    setSearchInput(bestMatch.displayName);
  };

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
            <CardDescription>Type NIN, email, phone, or name. Select from suggestions and submit.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setSelectedCandidate(null);
              }}
              placeholder="Search by NIN, email, phone, or name"
            />
            <Button onClick={onSearchSubmit}>Submit</Button>
          </div>
          {searchInput.trim().length >= 2 && candidates.length > 0 ? (
            <div className="max-h-52 overflow-y-auto rounded-md border border-border">
              {candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="flex w-full flex-col items-start border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/10"
                  onClick={() => {
                    setSelectedCandidate(candidate);
                    setSearchInput(candidate.displayName);
                  }}
                >
                  <span className="text-sm font-medium text-foreground">{candidate.displayName}</span>
                  <span className="text-xs text-muted">
                    {[candidate.nin, candidate.email, candidate.phone].filter(Boolean).join(' | ') || candidate.id}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
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
                    <CardDescription>User ID: {userAccessQuery.data?.userId ?? targetUserId}</CardDescription>
                  </div>
                </CardHeader>
                <p className="text-sm text-foreground">Name: {userAccessQuery.data?.userName ?? selectedCandidate?.displayName ?? 'Loading...'}</p>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Rows (Roles)</CardTitle>
                    <CardDescription>Current rows are preselected. Add/remove rows with multi-select.</CardDescription>
                  </div>
                </CardHeader>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {(rolesQuery.data ?? []).map((role) => {
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
                            setSelectedRoleIds((prev) => {
                              const next = new Set(prev);
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
                <div className="space-y-2">
                  {permissionRows.map((permission) => {
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
                            variant={overrideMap[permission.key] === 'allow' ? 'default' : 'outline'}
                            onClick={() =>
                              setOverrideMap((prev) => {
                                const next = { ...prev };
                                if (prev[permission.key] === 'allow') delete next[permission.key];
                                else next[permission.key] = 'allow';
                                return next;
                              })
                            }
                          >
                            Can
                          </Button>
                          <Button
                            size="sm"
                            variant={overrideMap[permission.key] === 'deny' ? 'destructive' : 'outline'}
                            onClick={() =>
                              setOverrideMap((prev) => {
                                const next = { ...prev };
                                if (prev[permission.key] === 'deny') delete next[permission.key];
                                else next[permission.key] = 'deny';
                                return next;
                              })
                            }
                          >
                            Cannot
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setOverrideMap((prev) => {
                                const next = { ...prev };
                                delete next[permission.key];
                                return next;
                              })
                            }
                          >
                            Inherit
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <Button
                    loading={replaceOverrides.isPending}
                    loadingText="Saving permissions..."
                    onClick={async () => {
                      const overrides = Object.entries(overrideMap)
                        .filter(([, effect]) => effect === 'allow' || effect === 'deny')
                        .map(([permissionKey, effect]) => ({ permissionKey, effect }));
                      await replaceOverrides.mutateAsync({ userId: targetUserId, overrides });
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
