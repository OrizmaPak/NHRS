import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { useContextStore } from '@/stores/contextStore';
import { useAuthStore } from '@/stores/authStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import { findInterfacePermissions, getPermissionDisplayMeta, groupPermissionsByDisplay } from '@/lib/interfacePermissions';
import {
  searchAccessUsers,
  useOrgPermissions,
  useOrgRoles,
  useSaveOrgRole,
  useReplaceUserOverrides,
  useReplaceUserRoles,
  useUserAccess,
  type UserSearchResult,
} from '@/api/hooks/useAccessControl';
import { useOrganizationMember, useUpdateMemberScopeAssignment } from '@/api/hooks/useOrganizationStaff';

type OverrideEffect = 'allow' | 'deny';
type ScopedOverrideRule = { permissionKey: string; effect: OverrideEffect; roleName?: string };
type AccessScopeType = 'organization' | 'institution' | 'branch';
const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(3, 'Description is required'),
});
type CreateRoleValues = z.infer<typeof createRoleSchema>;

const ALL_ROLES_SCOPE = '__all__';

function normalizeAccessScopeType(value?: string | null): AccessScopeType {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'institution') return 'institution';
  if (normalized === 'branch') return 'branch';
  return 'organization';
}

function looksLikeOpaqueIdentifier(value?: string | null) {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (/^[a-f0-9]{24}$/i.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) return true;
  if (/^[A-Za-z0-9_-]{18,}$/.test(v) && !/\s/.test(v)) return true;
  return false;
}

export function OrgStaffAccessPage() {
  const { userId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const authUser = useAuthStore((state) => state.user);
  const activeContext = useContextStore((state) => state.activeContext);
  const organizationId = getOrganizationIdFromContext(activeContext);
  const initialUserId = userId === 'self' ? String(authUser?.id ?? '') : userId;
  const scopeType = normalizeAccessScopeType(searchParams.get('scopeType'));
  const scopeId = String(searchParams.get('scopeId') || '').trim();
  const scopedInstitutionId = scopeType === 'branch'
    ? String(searchParams.get('institutionId') || '').trim() || null
    : (scopeType === 'institution' ? scopeId || null : null);
  const scopedBranchId = scopeType === 'branch' ? scopeId || null : null;
  const scopedMemberId = String(searchParams.get('memberId') || '').trim();
  const scopedAssignmentId = String(searchParams.get('assignmentId') || '').trim();
  const isScopedAccess = scopeType !== 'organization';

  const [userLookup, setUserLookup] = useState<Record<string, UserSearchResult>>({});
  const [selectedUserValue, setSelectedUserValue] = useState<string | null>(initialUserId || null);
  const [selectedCandidate, setSelectedCandidate] = useState<UserSearchResult | null>(null);
  const [targetUserId, setTargetUserId] = useState(initialUserId || '');
  const [roleSearch, setRoleSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [manualRoleSelection, setManualRoleSelection] = useState<Set<string> | null>(null);
  const [manualOverrideRules, setManualOverrideRules] = useState<ScopedOverrideRule[] | null>(null);
  const [overrideRoleScope, setOverrideRoleScope] = useState<string | null>(null);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [selectedRolePermissionKeys, setSelectedRolePermissionKeys] = useState<Set<string>>(new Set());

  const rolesQuery = useOrgRoles(organizationId);
  const permissionsQuery = useOrgPermissions(organizationId);
  const scopedMemberQuery = useOrganizationMember(organizationId, isScopedAccess ? scopedMemberId : undefined);
  const userAccessQuery = useUserAccess(targetUserId, organizationId, {
    scopeType,
    institutionId: scopedInstitutionId ?? undefined,
    branchId: scopedBranchId ?? undefined,
  });
  const replaceRoles = useReplaceUserRoles('organization');
  const replaceOverrides = useReplaceUserOverrides('organization');
  const updateMemberScopeAssignment = useUpdateMemberScopeAssignment();
  const saveOrgRole = useSaveOrgRole();

  const createRoleForm = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '' },
  });

  const scopedAssignments = useMemo(() => {
    const assignments = scopedMemberQuery.data?.assignments ?? [];
    if (scopeType === 'branch') {
      return assignments.filter((assignment) => String(assignment.branchId || '').trim() === String(scopedBranchId || '').trim());
    }
    if (scopeType === 'institution') {
      return assignments.filter((assignment) =>
        String(assignment.institutionId || '').trim() === String(scopedInstitutionId || '').trim()
        && !String(assignment.branchId || '').trim(),
      );
    }
    return [];
  }, [scopeType, scopedBranchId, scopedInstitutionId, scopedMemberQuery.data?.assignments]);

  const editableScopedAssignment = useMemo(() => {
    if (!isScopedAccess) return null;
    if (scopedAssignmentId) {
      return scopedAssignments.find((assignment) => String(assignment.assignmentId || '').trim() === scopedAssignmentId) ?? null;
    }
    if (scopedAssignments.length === 1) return scopedAssignments[0];
    return null;
  }, [isScopedAccess, scopedAssignmentId, scopedAssignments]);

  const scopeTitle = scopeType === 'branch'
    ? 'Branch Staff Access'
    : scopeType === 'institution'
      ? 'Institution Staff Access'
      : 'Organization Staff Access';
  const scopeDescription = scopeType === 'branch'
    ? 'Manage the selected user role within this branch scope.'
    : scopeType === 'institution'
      ? 'Manage the selected user role within this institution scope.'
      : 'Search staff, assign organization roles, and set role-specific can/cannot overrides.';
  const scopeRoleDescription = scopeType === 'branch'
    ? 'Assigned branch roles are preselected and can be updated.'
    : scopeType === 'institution'
      ? 'Assigned institution roles are preselected and can be updated.'
      : 'Assigned organization roles are preselected and can be updated.';

  const displayedCandidate = selectedCandidate ?? (targetUserId ? userLookup[targetUserId] ?? null : null);
  const apiReportedName = userAccessQuery.data?.userName?.trim() ?? '';
  const displayedName =
    displayedCandidate?.displayName ??
    (apiReportedName && !looksLikeOpaqueIdentifier(apiReportedName) ? apiReportedName : null) ??
    (initialUserId && authUser?.id === initialUserId ? authUser.fullName : null) ??
    'Loading...';
  const displayedNin =
    scopedMemberQuery.data?.nin ??
    displayedCandidate?.nin ??
    (initialUserId && authUser?.id === initialUserId ? authUser.nin : undefined) ??
    'Not available';

  const roleRowsById = useMemo(() => new Map((rolesQuery.data ?? []).map((role) => [role.id, role] as const)), [rolesQuery.data]);
  const roleRowsByName = useMemo(
    () => new Map((rolesQuery.data ?? []).map((role) => [String(role.name || '').trim().toLowerCase(), role] as const)),
    [rolesQuery.data],
  );
  const scopedRoleIds = useMemo(() => new Set(
    Array.from(new Set(scopedAssignments.flatMap((assignment) => assignment.roles)))
      .map((roleName) => roleRowsByName.get(String(roleName || '').trim().toLowerCase())?.id)
      .filter((roleId): roleId is string => Boolean(roleId)),
  ), [roleRowsByName, scopedAssignments]);

  const assignedRoleIds = useMemo(() => {
    if (isScopedAccess) {
      return scopedRoleIds;
    }
    if (!userAccessQuery.data) return new Set<string>();
    return new Set((userAccessQuery.data.roleIds ?? []).map((id) => String(id)).filter(Boolean));
  }, [isScopedAccess, scopedRoleIds, userAccessQuery.data]);

  const selectedRoleIds = manualRoleSelection ?? assignedRoleIds;

  const selectedRoleNames = useMemo(
    () =>
      Array.from(selectedRoleIds)
        .map((roleId) => roleRowsById.get(roleId)?.name?.trim().toLowerCase())
        .filter((name): name is string => Boolean(name)),
    [roleRowsById, selectedRoleIds],
  );

  const assignedOverrideRules = useMemo(() => {
    if (isScopedAccess) return [];
    return (userAccessQuery.data?.overrides ?? []).map((override) => ({
      permissionKey: override.key,
      effect: override.effect,
      roleName: override.roleName ? String(override.roleName).trim().toLowerCase() : undefined,
    }));
  }, [isScopedAccess, userAccessQuery.data?.overrides]);

  const overrideRules = manualOverrideRules ?? assignedOverrideRules;

  const resolvedOverrideRoleScope = useMemo(() => {
    if (overrideRoleScope && (overrideRoleScope === ALL_ROLES_SCOPE || selectedRoleNames.includes(overrideRoleScope))) {
      return overrideRoleScope;
    }
    if (selectedRoleNames.length > 0) return selectedRoleNames[0];
    return ALL_ROLES_SCOPE;
  }, [overrideRoleScope, selectedRoleNames]);

  const scopedUserAccessQuery = useUserAccess(
    targetUserId,
    organizationId,
    {
      activeRoleName: resolvedOverrideRoleScope === ALL_ROLES_SCOPE ? undefined : resolvedOverrideRoleScope,
      scopeType,
      institutionId: scopedInstitutionId ?? undefined,
      branchId: scopedBranchId ?? undefined,
    },
  );

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
      const meta = getPermissionDisplayMeta(permission);
      return `${permission.key} ${permission.description} ${meta.title} ${meta.groupLabel} ${meta.actionLabel} ${meta.interfaceSummary ?? ''} ${meta.routeSummary ?? ''}`.toLowerCase().includes(key);
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
  const groupedInterfacePermissionRows = useMemo(() => groupPermissionsByDisplay(interfacePermissionRows), [interfacePermissionRows]);
  const groupedOtherPermissionRows = useMemo(() => groupPermissionsByDisplay(otherPermissionRows), [otherPermissionRows]);

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

  const serverEffectivePermissionMap = useMemo(() => {
    const mapped: Record<string, 'allow' | 'deny' | 'inherit'> = {};
    for (const entry of scopedUserAccessQuery.data?.effectivePermissions ?? []) {
      mapped[entry.key] = entry.granted ? 'allow' : 'deny';
    }
    return mapped;
  }, [scopedUserAccessQuery.data?.effectivePermissions]);

  const filteredRoles = useMemo(() => {
    const roles = rolesQuery.data ?? [];
    const key = roleSearch.trim().toLowerCase();
    if (!key) return roles;
    return roles.filter((role) => `${role.name} ${role.description}`.toLowerCase().includes(key));
  }, [roleSearch, rolesQuery.data]);

  const effectivePermissionState = (permissionKey: string): 'allow' | 'deny' | 'inherit' => {
    if (!manualRoleSelection && !manualOverrideRules) {
      const resolved = serverEffectivePermissionMap[permissionKey];
      if (resolved) return resolved;
    }
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
      if (targetRole) return [...filtered, { permissionKey, effect, roleName: targetRole }];
      return [...filtered, { permissionKey, effect }];
    });
  };

  const loadUserOptions = useCallback(async (term: string) => {
    const users = await searchAccessUsers(term);
    if (users.length > 0) {
      setUserLookup((prev) => {
        const next = { ...prev };
        users.forEach((entry) => {
          next[entry.id] = entry;
        });
        return next;
      });
    }
    return users.map((entry) => ({
      value: entry.id,
      label: entry.displayName,
      description: [entry.nin, entry.bvn ? `BVN:${entry.bvn}` : undefined, entry.email, entry.phone].filter(Boolean).join(' | ') || entry.id,
    }));
  }, []);

  if (!organizationId) {
    return <ErrorState title="Organization context required" description="Switch to an organization context to manage staff access." />;
  }

  if (isScopedAccess && !scopedMemberId) {
    return <ErrorState title="Scoped access target required" description="Open this page from the institution or branch staff table." />;
  }

  if (userId === 'self' && !authUser?.id) {
    return <ErrorState title="Loading user context" description="Fetching your account context..." />;
  }

  if (isScopedAccess && scopedMemberQuery.isError) {
    return <ErrorState title="Unable to load scoped access" description="Retry loading the selected staff scope." onRetry={() => scopedMemberQuery.refetch()} />;
  }

  if (isScopedAccess && !scopedMemberQuery.isLoading && !scopedMemberQuery.data) {
    return <ErrorState title="Scoped staff record not found" description="The selected institution or branch assignment could not be found." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={scopeTitle}
        description={scopeDescription}
        breadcrumbs={[{ label: 'Organization' }, { label: 'Access Control' }, { label: 'Staff Access' }]}
      />

      {!isScopedAccess ? (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Find User</CardTitle>
            <CardDescription>Search by NIN, BVN, email, phone, or name.</CardDescription>
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
            debounceMs={1250}
            loadOptions={loadUserOptions}
          />
        </div>
      </Card>
      ) : null}

      {targetUserId ? (
        <>
          {userAccessQuery.isError && !isScopedAccess ? (
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
                {isScopedAccess ? (
                  <p className="mt-2 text-sm text-muted">
                    Scope: {scopeType === 'branch'
                      ? `Branch${editableScopedAssignment?.branchName ? ` - ${editableScopedAssignment.branchName}` : ''}`
                      : `Institution${editableScopedAssignment?.institutionName ? ` - ${editableScopedAssignment.institutionName}` : ''}`}
                  </p>
                ) : null}
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Roles</CardTitle>
                    <CardDescription>{scopeRoleDescription}</CardDescription>
                  </div>
                </CardHeader>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="w-full md:max-w-md">
                    <SearchInput value={roleSearch} onChange={setRoleSearch} placeholder="Search roles by name or description" />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      createRoleForm.reset({ name: '', description: '' });
                      setSelectedRolePermissionKeys(new Set());
                      setShowCreateRoleModal(true);
                    }}
                  >
                    Create Role
                  </Button>
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
                  {filteredRoles.length === 0 ? (
                    <div className="rounded border border-border p-3 text-sm text-muted">No organization roles found.</div>
                  ) : null}
                </div>
                <div className="mt-3">
                  <Button
                    loading={isScopedAccess ? updateMemberScopeAssignment.isPending : replaceRoles.isPending}
                    loadingText="Saving roles..."
                    disabled={isScopedAccess && !editableScopedAssignment}
                    onClick={async () => {
                      if (isScopedAccess) {
                        if (!editableScopedAssignment || !scopedMemberId) {
                          toast.error('Open a specific institution or branch assignment to edit scoped roles.');
                          return;
                        }
                        await updateMemberScopeAssignment.mutateAsync({
                          orgId: organizationId,
                          memberId: scopedMemberId,
                          assignmentId: editableScopedAssignment.assignmentId,
                          roles: Array.from(selectedRoleIds)
                            .map((roleId) => roleRowsById.get(roleId)?.name)
                            .filter((roleName): roleName is string => Boolean(roleName)),
                        });
                      } else {
                        await replaceRoles.mutateAsync({
                          userId: targetUserId,
                          roleIds: Array.from(selectedRoleIds),
                          organizationId,
                        });
                      }
                      setManualRoleSelection(null);
                      setManualOverrideRules(null);
                      toast.success('Roles updated');
                    }}
                  >
                    Save Roles
                  </Button>
                  {isScopedAccess && !editableScopedAssignment ? (
                    <p className="mt-2 text-xs text-muted">
                      This staff record has more than one scope under the selected view. Open access from the exact branch row to edit one assignment.
                    </p>
                  ) : null}
                </div>
              </Card>

              {!isScopedAccess ? (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Specific Permissions (Can / Cannot)</CardTitle>
                    <CardDescription>
                      Cannot override takes precedence over role permissions. Role scope selection applies overrides to a specific role.
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
                    <option value={ALL_ROLES_SCOPE}>All assigned roles (global override)</option>
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
                    {groupedInterfacePermissionRows.map((group) => (
                      <section key={group.label} className="rounded-lg border border-border p-3">
                        <div className="mb-3 flex items-center justify-between">
                          <h5 className="text-sm font-semibold text-foreground">{group.label}</h5>
                          <Badge variant="info">{group.items.length} permissions</Badge>
                        </div>
                        <div className="space-y-2">
                          {group.items.map((permission) => {
                            const meta = getPermissionDisplayMeta(permission);
                            const state = effectivePermissionState(permission.key);
                            return (
                              <div key={permission.key} className="rounded border border-border p-3">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <div>
                                    <p className="text-sm font-medium text-foreground">{meta.title}</p>
                                    <p className="text-[11px] text-muted">{permission.key}</p>
                                  </div>
                                  <Badge variant={state === 'deny' ? 'danger' : state === 'allow' ? 'success' : 'outline'}>
                                    {state.toUpperCase()}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted">{meta.helperText}</p>
                                {meta.interfaceSummary ? (
                                  <p className="mt-1 text-xs text-primary">
                                    Used in: {meta.interfaceSummary}
                                    {meta.interfaceCount > 2 ? ` +${meta.interfaceCount - 2} more` : ''}
                                    {meta.routeSummary ? ` (${meta.routeSummary})` : ''}
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
                        </div>
                      </section>
                    ))}
                  </section>

                  {groupedOtherPermissionRows.length > 0 ? (
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold text-foreground">Other Action Permissions</h4>
                      {groupedOtherPermissionRows.map((group) => (
                        <section key={group.label} className="rounded-lg border border-border p-3">
                          <div className="mb-3 flex items-center justify-between">
                            <h5 className="text-sm font-semibold text-foreground">{group.label}</h5>
                            <Badge variant="info">{group.items.length} permissions</Badge>
                          </div>
                          <div className="space-y-2">
                            {group.items.map((permission) => {
                              const meta = getPermissionDisplayMeta(permission);
                              const state = effectivePermissionState(permission.key);
                              return (
                                <div key={permission.key} className="rounded border border-border p-3">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <div>
                                      <p className="text-sm font-medium text-foreground">{meta.title}</p>
                                      <p className="text-[11px] text-muted">{permission.key}</p>
                                    </div>
                                    <Badge variant={state === 'deny' ? 'danger' : state === 'allow' ? 'success' : 'outline'}>
                                      {state.toUpperCase()}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-muted">{meta.helperText}</p>
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
                          </div>
                        </section>
                      ))}
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
                      await replaceOverrides.mutateAsync({ userId: targetUserId, overrides, organizationId });
                      setManualOverrideRules(null);
                      toast.success('Specific permissions updated');
                    }}
                  >
                    Save Specific Permissions
                  </Button>
                </div>
              </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Specific Permissions</CardTitle>
                      <CardDescription>
                        Institution and branch access currently inherit permissions from the selected scoped role. Direct can/cannot overrides remain organization-wide only.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <div className="space-y-4">
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold text-foreground">Effective Permissions</h4>
                      {groupedInterfacePermissionRows.map((group) => (
                        <section key={group.label} className="rounded-lg border border-border p-3">
                          <div className="mb-3 flex items-center justify-between">
                            <h5 className="text-sm font-semibold text-foreground">{group.label}</h5>
                            <Badge variant="info">{group.items.length} permissions</Badge>
                          </div>
                          <div className="space-y-2">
                            {group.items.map((permission) => {
                              const meta = getPermissionDisplayMeta(permission);
                              const state = effectivePermissionState(permission.key);
                              return (
                                <div key={permission.key} className="rounded border border-border p-3">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <div>
                                      <p className="text-sm font-medium text-foreground">{meta.title}</p>
                                      <p className="text-[11px] text-muted">{permission.key}</p>
                                    </div>
                                    <Badge variant={state === 'deny' ? 'danger' : state === 'allow' ? 'success' : 'outline'}>
                                      {state.toUpperCase()}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-muted">{meta.helperText}</p>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </section>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      ) : null}

      <Modal open={showCreateRoleModal} onOpenChange={setShowCreateRoleModal} title="Create Organization Role">
        <form
          className="space-y-3"
          onSubmit={createRoleForm.handleSubmit(async (values) => {
            if (!organizationId) return;
            try {
              await saveOrgRole.mutateAsync({
                name: values.name,
                description: values.description,
                permissions: Array.from(selectedRolePermissionKeys),
                organizationId,
              });
              const refreshed = await rolesQuery.refetch();
              const createdRole = (refreshed.data ?? []).find(
                (role) => role.name.trim().toLowerCase() === values.name.trim().toLowerCase(),
              );
              if (createdRole?.id) {
                setManualRoleSelection((prev) => {
                  const base = prev ?? new Set(selectedRoleIds);
                  const next = new Set(base);
                  next.add(createdRole.id);
                  return next;
                });
              }
              toast.success('Role created');
              setShowCreateRoleModal(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to create role');
            }
          })}
        >
          <FormField label="Role Name">
            <Input {...createRoleForm.register('name')} placeholder="operations_manager" />
          </FormField>
          <FormField label="Description">
            <Input {...createRoleForm.register('description')} placeholder="Organization operations manager" />
          </FormField>
          <PermissionMatrix
            permissions={(permissionsQuery.data ?? []).map((entry) => ({
              key: entry.key,
              module: entry.module,
              description: entry.description,
            }))}
            selected={selectedRolePermissionKeys}
            onToggle={(key, checked) => {
              setSelectedRolePermissionKeys((prev) => {
                const next = new Set(prev);
                if (checked) next.add(key);
                else next.delete(key);
                return next;
              });
            }}
          />
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreateRoleModal(false)}>Cancel</Button>
            <Button type="submit" loading={saveOrgRole.isPending}>Create Role</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
