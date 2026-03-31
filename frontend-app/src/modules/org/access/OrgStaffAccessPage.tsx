import { useCallback, useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
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
import { CollapsiblePermissionSection } from '@/components/access/CollapsiblePermissionSection';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { useContextStore } from '@/stores/contextStore';
import { useAuthStore } from '@/stores/authStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import { findInterfacePermissions, getPermissionDisplayMeta, groupPermissionsByDisplay } from '@/lib/interfacePermissions';
import { useInstitutionBranches, useOrgInstitutions } from '@/api/hooks/useInstitutions';
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
import {
  searchOrganizationMembers,
  useOrganizationMember,
  useUpdateMemberScopeAssignment,
  type OrganizationMemberRow,
  type StaffAssignment,
} from '@/api/hooks/useOrganizationStaff';

type OverrideEffect = 'allow' | 'deny';
type ScopedOverrideRule = {
  permissionKey: string;
  effect: OverrideEffect;
  roleName?: string;
  scopeType?: AccessScopeType;
  institutionId?: string;
  branchId?: string;
};
type AccessScopeType = 'organization' | 'institution' | 'branch';
const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(3, 'Description is required'),
});
type CreateRoleValues = z.infer<typeof createRoleSchema>;
type StaffAccessCandidate = UserSearchResult & {
  memberId?: string;
  assignmentId?: string;
  member?: OrganizationMemberRow;
  status?: string;
};
type NinLookupItem = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  otherName?: string | null;
  email?: string | null;
  phone?: string | null;
  bvn?: string | null;
};

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

function normalizeScopeId(value?: string | null) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function overrideMatchesCurrentScope(
  entry: Pick<ScopedOverrideRule, 'scopeType' | 'institutionId' | 'branchId'>,
  scopeType: AccessScopeType,
  institutionId?: string | null,
  branchId?: string | null,
) {
  const targetInstitutionId = normalizeScopeId(institutionId);
  const targetBranchId = normalizeScopeId(branchId);
  const entryScopeType = entry.scopeType ?? 'organization';
  const entryInstitutionId = normalizeScopeId(entry.institutionId);
  const entryBranchId = normalizeScopeId(entry.branchId);

  if (entryScopeType === 'organization') return scopeType === 'organization';
  if (entryScopeType === 'institution') {
    if (!entryInstitutionId) return false;
    return scopeType === 'institution' && entryInstitutionId === targetInstitutionId;
  }
  if (entryScopeType === 'branch') {
    if (!entryBranchId) return false;
    return scopeType === 'branch' && entryBranchId === targetBranchId;
  }
  return false;
}

function buildScopedOverrideRule(
  permissionKey: string,
  effect: OverrideEffect,
  roleName: string,
  scopeType: AccessScopeType,
  institutionId?: string | null,
  branchId?: string | null,
): ScopedOverrideRule {
  return {
    permissionKey,
    effect,
    ...(roleName ? { roleName } : {}),
    ...(scopeType === 'organization' ? { scopeType: 'organization' as const } : {}),
    ...(scopeType === 'institution' ? { scopeType: 'institution' as const, institutionId: normalizeScopeId(institutionId) } : {}),
    ...(scopeType === 'branch'
      ? {
          scopeType: 'branch' as const,
          institutionId: normalizeScopeId(institutionId),
          branchId: normalizeScopeId(branchId),
        }
      : {}),
  };
}

function getScopedAssignments(
  assignments: StaffAssignment[],
  scopeType: AccessScopeType,
  institutionId?: string | null,
  branchId?: string | null,
) {
  if (scopeType === 'branch') {
    return assignments.filter((assignment) => String(assignment.branchId || '').trim() === String(branchId || '').trim());
  }
  if (scopeType === 'institution') {
    return assignments.filter((assignment) => (
      String(assignment.institutionId || '').trim() === String(institutionId || '').trim()
      && !String(assignment.branchId || '').trim()
    ));
  }
  return [];
}

function getPreferredScopedAssignment(
  assignments: StaffAssignment[],
  scopeType: AccessScopeType,
  institutionId?: string | null,
  branchId?: string | null,
  assignmentId?: string | null,
) {
  const scopedAssignments = getScopedAssignments(assignments, scopeType, institutionId, branchId);
  if (assignmentId) {
    return scopedAssignments.find((assignment) => String(assignment.assignmentId || '').trim() === String(assignmentId || '').trim()) ?? null;
  }
  if (scopedAssignments.length === 1) return scopedAssignments[0];
  return null;
}

export function OrgStaffAccessPage() {
  const { userId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const authUser = useAuthStore((state) => state.user);
  const activeContext = useContextStore((state) => state.activeContext);
  const organizationId = getOrganizationIdFromContext(activeContext);
  const initialUserId = userId === 'self' ? String(authUser?.id ?? '') : userId;
  const initialDisplayName = String(searchParams.get('displayName') || '').trim();
  const initialNin = String(searchParams.get('nin') || '').trim();
  const initialScopeType = normalizeAccessScopeType(searchParams.get('scopeType'));
  const scopeId = String(searchParams.get('scopeId') || '').trim();
  const initialScopedInstitutionId = initialScopeType === 'branch'
    ? String(searchParams.get('institutionId') || '').trim() || null
    : (initialScopeType === 'institution' ? scopeId || null : null);
  const initialScopedBranchId = initialScopeType === 'branch' ? scopeId || null : null;
  const initialScopedMemberId = String(searchParams.get('memberId') || '').trim();
  const initialScopedAssignmentId = String(searchParams.get('assignmentId') || '').trim();
  const initialCandidate = initialUserId
    ? {
        id: initialUserId,
        displayName: initialDisplayName || initialUserId,
        nin: initialNin || undefined,
        memberId: initialScopedMemberId || undefined,
        assignmentId: initialScopedAssignmentId || undefined,
      }
    : null;

  const [activeScopeType, setActiveScopeType] = useState<AccessScopeType>(initialScopeType);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(initialScopedInstitutionId);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(initialScopedBranchId);
  const [selectedMemberId, setSelectedMemberId] = useState(initialScopedMemberId || '');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(initialScopedAssignmentId || '');
  const effectiveInstitutionId = activeScopeType === 'branch'
    ? selectedInstitutionId
    : (activeScopeType === 'institution' ? selectedInstitutionId : null);
  const effectiveBranchId = activeScopeType === 'branch' ? selectedBranchId : null;
  const isScopedAccess = activeScopeType !== 'organization';

  const [userLookup, setUserLookup] = useState<Record<string, StaffAccessCandidate>>(
    initialCandidate ? { [initialCandidate.id]: initialCandidate } : {},
  );
  const [selectedUserValue, setSelectedUserValue] = useState<string | null>(initialUserId || null);
  const [selectedCandidate, setSelectedCandidate] = useState<StaffAccessCandidate | null>(initialCandidate);
  const [targetUserId, setTargetUserId] = useState(initialUserId || '');
  const [roleSearch, setRoleSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [manualRoleSelection, setManualRoleSelection] = useState<Set<string> | null>(null);
  const [manualOverrideRules, setManualOverrideRules] = useState<ScopedOverrideRule[] | null>(null);
  const [overrideRoleScope, setOverrideRoleScope] = useState<string | null>(null);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [selectedRolePermissionKeys, setSelectedRolePermissionKeys] = useState<Set<string>>(new Set());
  const clearSelectedStaff = useCallback(() => {
    setSelectedUserValue(null);
    setSelectedCandidate(null);
    setTargetUserId('');
    setSelectedMemberId('');
    setSelectedAssignmentId('');
    setManualRoleSelection(null);
    setManualOverrideRules(null);
    setOverrideRoleScope(null);
  }, []);

  const institutionsQuery = useOrgInstitutions(organizationId);
  const institutionBranchesQuery = useInstitutionBranches(organizationId, selectedInstitutionId || undefined);
  const rolesQuery = useOrgRoles(organizationId);
  const permissionsQuery = useOrgPermissions(organizationId);
  const memberQuery = useOrganizationMember(organizationId, selectedMemberId || undefined);
  const userAccessQuery = useUserAccess(targetUserId, organizationId, {
    scopeType: activeScopeType,
    institutionId: effectiveInstitutionId ?? undefined,
    branchId: effectiveBranchId ?? undefined,
  });
  const replaceRoles = useReplaceUserRoles('organization');
  const replaceOverrides = useReplaceUserOverrides('organization');
  const updateMemberScopeAssignment = useUpdateMemberScopeAssignment();
  const saveOrgRole = useSaveOrgRole();

  const createRoleForm = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '' },
  });

  const institutionOptions = useMemo(
    () =>
      (institutionsQuery.data?.rows ?? []).map((row) => ({
        value: row.institutionId,
        label: `${row.name}${row.code ? ` (${row.code})` : ''}`,
      })),
    [institutionsQuery.data?.rows],
  );
  const branchOptions = useMemo(
    () =>
      (institutionBranchesQuery.data ?? []).map((row) => ({
        value: row.branchId,
        label: `${row.name}${row.code ? ` (${row.code})` : ''}`,
      })),
    [institutionBranchesQuery.data],
  );
  const selectedInstitutionLabel = institutionOptions.find((entry) => entry.value === selectedInstitutionId)?.label || null;
  const selectedBranchLabel = branchOptions.find((entry) => entry.value === selectedBranchId)?.label || null;
  const activeMember = memberQuery.data ?? selectedCandidate?.member ?? null;

  const scopedAssignments = useMemo(() => {
    return getScopedAssignments(activeMember?.assignments ?? [], activeScopeType, effectiveInstitutionId, effectiveBranchId);
  }, [activeMember?.assignments, activeScopeType, effectiveBranchId, effectiveInstitutionId]);

  const editableScopedAssignment = useMemo(() => {
    if (!isScopedAccess) return null;
    return getPreferredScopedAssignment(
      activeMember?.assignments ?? [],
      activeScopeType,
      effectiveInstitutionId,
      effectiveBranchId,
      selectedAssignmentId,
    );
  }, [activeMember?.assignments, activeScopeType, effectiveBranchId, effectiveInstitutionId, isScopedAccess, selectedAssignmentId]);

  const pageDescription = activeScopeType === 'branch'
    ? 'Search branch staff and manage branch-scoped roles and permissions.'
    : activeScopeType === 'institution'
      ? 'Search institution staff and manage institution-scoped roles and permissions.'
      : 'Search staff and manage roles and specific permissions.';
  const scopeRoleDescription = activeScopeType === 'branch'
    ? 'Assigned branch roles are preselected and can be updated.'
    : activeScopeType === 'institution'
      ? 'Assigned institution roles are preselected and can be updated.'
      : 'Assigned roles are preselected and can be updated.';

  const displayedCandidate = selectedCandidate ?? (targetUserId ? userLookup[targetUserId] ?? null : null);
  const apiReportedName = userAccessQuery.data?.userName?.trim() ?? '';
  const displayedName =
    displayedCandidate?.displayName ??
    (apiReportedName && !looksLikeOpaqueIdentifier(apiReportedName) ? apiReportedName : null) ??
    (initialUserId && authUser?.id === initialUserId ? authUser.fullName : null) ??
    'Loading...';
  const displayedNin =
    activeMember?.nin ??
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
    return (userAccessQuery.data?.overrides ?? [])
      .filter((override) => overrideMatchesCurrentScope(override, activeScopeType, effectiveInstitutionId, effectiveBranchId))
      .map((override) => ({
      permissionKey: override.key,
      effect: override.effect,
      roleName: override.roleName ? String(override.roleName).trim().toLowerCase() : undefined,
      scopeType: override.scopeType,
      institutionId: override.institutionId ?? undefined,
      branchId: override.branchId ?? undefined,
    }));
  }, [activeScopeType, effectiveBranchId, effectiveInstitutionId, userAccessQuery.data?.overrides]);

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
      scopeType: activeScopeType,
      institutionId: effectiveInstitutionId ?? undefined,
      branchId: effectiveBranchId ?? undefined,
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
  const activeScopedOverrideCount = Object.keys(scopedOverrideMap).length;

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
        return entryRole !== targetRole
          || !overrideMatchesCurrentScope(entry, activeScopeType, effectiveInstitutionId, effectiveBranchId);
      });
      if (!effect) return filtered;
      return [
        ...filtered,
        buildScopedOverrideRule(permissionKey, effect, targetRole, activeScopeType, effectiveInstitutionId, effectiveBranchId),
      ];
    });
  };

  const buildCandidateFromMember = useCallback(async (
    member: OrganizationMemberRow,
    preferred?: UserSearchResult,
  ): Promise<StaffAccessCandidate | null> => {
    const userIdValue = String(member.userId || '').trim();
    if (!userIdValue) return null;

    let displayName = String(preferred?.displayName || '').trim();
    let email = preferred?.email;
    let phone = preferred?.phone;
    let bvn = preferred?.bvn;

    if (!displayName) {
      try {
        const response = await apiClient.get<NinLookupItem>(endpoints.auth.ninLookup(member.nin), {
          suppressGlobalErrors: true,
        });
        displayName = String(
          response.fullName
          || [response.firstName, response.otherName, response.lastName].filter(Boolean).join(' ')
          || member.nin,
        ).trim();
        email = email || (response.email ? String(response.email) : undefined);
        phone = phone || (response.phone ? String(response.phone) : undefined);
        bvn = bvn || (response.bvn ? String(response.bvn) : undefined);
      } catch {
        displayName = member.nin;
      }
    }

    const preferredAssignment = getPreferredScopedAssignment(
      member.assignments,
      activeScopeType,
      effectiveInstitutionId,
      effectiveBranchId,
      selectedAssignmentId,
    );

    return {
      id: userIdValue,
      displayName: displayName || member.nin,
      nin: member.nin || preferred?.nin,
      email,
      phone,
      bvn,
      memberId: member.membershipId,
      assignmentId: preferredAssignment?.assignmentId,
      member,
      status: member.status,
    };
  }, [activeScopeType, effectiveBranchId, effectiveInstitutionId, selectedAssignmentId]);

  const loadUserOptions = useCallback(async (term: string) => {
    if (!organizationId) return [];
    if (activeScopeType === 'institution' && !effectiveInstitutionId) return [];
    if (activeScopeType === 'branch' && (!effectiveInstitutionId || !effectiveBranchId)) return [];

    const scopeFilter = {
      institutionId: activeScopeType === 'organization' ? undefined : (effectiveInstitutionId ?? undefined),
      branchId: activeScopeType === 'branch' ? (effectiveBranchId ?? undefined) : undefined,
    };

    const [directScopedSearch, globalMatches] = await Promise.all([
      searchOrganizationMembers(organizationId, {
        page: 1,
        limit: 20,
        q: term,
        ...scopeFilter,
      }),
      searchAccessUsers(term),
    ]);

    const candidates = new Map<string, StaffAccessCandidate>();
    const directCandidates = await Promise.all(
      directScopedSearch.rows.map((member) => buildCandidateFromMember(member)),
    );
    directCandidates
      .filter((candidate): candidate is StaffAccessCandidate => Boolean(candidate))
      .forEach((candidate) => {
        candidates.set(candidate.id, candidate);
      });

    const scopedGlobalCandidates = await Promise.all(
      globalMatches.slice(0, 10).map(async (entry) => {
        const lookupTerm = String(entry.nin || entry.id || '').trim();
        if (!lookupTerm) return null;
        const scopedSearch = await searchOrganizationMembers(organizationId, {
          page: 1,
          limit: 10,
          q: lookupTerm,
          ...scopeFilter,
        });
        const matchedMember = scopedSearch.rows.find((member) =>
          String(member.userId || '').trim() === entry.id || member.nin === entry.nin,
        );
        if (!matchedMember) return null;
        return buildCandidateFromMember(matchedMember, entry);
      }),
    );

    scopedGlobalCandidates
      .filter((candidate): candidate is StaffAccessCandidate => Boolean(candidate))
      .forEach((candidate) => {
        candidates.set(candidate.id, candidate);
      });

    if (candidates.size > 0) {
      setUserLookup((prev) => {
        const next = { ...prev };
        Array.from(candidates.values()).forEach((entry) => {
          next[entry.id] = entry;
        });
        return next;
      });
    }

    return Array.from(candidates.values()).map((entry) => ({
      value: entry.id,
      label: entry.displayName,
      description: [
        entry.nin,
        entry.status ? `Status:${entry.status}` : undefined,
        entry.bvn ? `BVN:${entry.bvn}` : undefined,
        entry.email,
        entry.phone,
      ].filter(Boolean).join(' | ') || entry.id,
    }));
  }, [activeScopeType, buildCandidateFromMember, effectiveBranchId, effectiveInstitutionId, organizationId]);

  const scopeSearchReady = activeScopeType === 'organization'
    || (activeScopeType === 'institution' && Boolean(effectiveInstitutionId))
    || (activeScopeType === 'branch' && Boolean(effectiveInstitutionId && effectiveBranchId));
  const scopeSearchEmptyLabel = activeScopeType === 'institution' && !effectiveInstitutionId
    ? 'Select an institution first'
    : activeScopeType === 'branch' && !effectiveInstitutionId
      ? 'Select an institution first'
      : activeScopeType === 'branch' && !effectiveBranchId
        ? 'Select a branch first'
        : 'No matching staff found in this scope';
  const scopeSearchPlaceholder = activeScopeType === 'organization'
    ? 'Search staff'
    : activeScopeType === 'institution'
      ? 'Search institution staff'
      : 'Search branch staff';
  const selectedScopeSummary = activeScopeType === 'branch'
    ? `Branch${selectedBranchLabel ? ` - ${selectedBranchLabel}` : ''}`
    : activeScopeType === 'institution'
      ? `Institution${selectedInstitutionLabel ? ` - ${selectedInstitutionLabel}` : ''}`
      : 'Organization';

  if (!organizationId) {
    return <ErrorState title="Organization context required" description="Switch to an organization context to manage staff access." />;
  }

  if (userId === 'self' && !authUser?.id) {
    return <ErrorState title="Loading user context" description="Fetching your account context..." />;
  }

  if (selectedMemberId && memberQuery.isError) {
    return <ErrorState title="Unable to load staff access" description="Retry loading the selected staff scope." onRetry={() => memberQuery.refetch()} />;
  }

  if (selectedMemberId && !memberQuery.isLoading && !activeMember) {
    return <ErrorState title="Staff record not found" description="The selected staff scope could not be found." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Access"
        description={pageDescription}
        breadcrumbs={[{ label: 'Organization' }, { label: 'Access Control' }, { label: 'Staff Access' }]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Find Staff</CardTitle>
            <CardDescription>Search within the selected organization, institution, or branch scope.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-4">
          <Tabs.Root
            value={activeScopeType}
            onValueChange={(next) => {
              const normalized = normalizeAccessScopeType(next);
              setActiveScopeType(normalized);
              if (normalized === 'organization') {
                setSelectedInstitutionId(null);
                setSelectedBranchId(null);
              }
              if (normalized === 'institution') {
                setSelectedBranchId(null);
              }
              clearSelectedStaff();
            }}
          >
            <Tabs.List className="inline-flex flex-wrap rounded-md border border-border bg-surface p-1">
              <Tabs.Trigger value="organization" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Organization</Tabs.Trigger>
              <Tabs.Trigger value="institution" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Institution</Tabs.Trigger>
              <Tabs.Trigger value="branch" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Branch</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>

          <div className="grid gap-4 md:grid-cols-2">
            {activeScopeType !== 'organization' ? (
              <div className="w-full">
                <FormField label="Institution">
                  <SmartSelect
                    value={selectedInstitutionId}
                    selectedLabel={selectedInstitutionLabel}
                    onChange={(value) => {
                      setSelectedInstitutionId(value);
                      setSelectedBranchId(null);
                      clearSelectedStaff();
                    }}
                    placeholder="Select institution"
                    emptyLabel="No institution found"
                    loadOptions={async (input) =>
                      institutionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                    }
                  />
                </FormField>
              </div>
            ) : null}
            {activeScopeType === 'branch' ? (
              <div className="w-full">
                <FormField label="Branch">
                  <SmartSelect
                    value={selectedBranchId}
                    selectedLabel={selectedBranchLabel}
                    onChange={(value) => {
                      setSelectedBranchId(value);
                      clearSelectedStaff();
                    }}
                    placeholder="Select branch"
                    emptyLabel={selectedInstitutionId ? 'No branch found' : 'Select institution first'}
                    loadOptions={async (input) =>
                      selectedInstitutionId
                        ? branchOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                        : []
                    }
                  />
                </FormField>
              </div>
            ) : null}
          </div>

          <div className="w-full md:max-w-xl">
            <SmartSelect
              value={selectedUserValue}
              selectedLabel={displayedCandidate?.displayName || (displayedName !== 'Loading...' ? displayedName : null)}
              onChange={(value) => {
                if (!value) {
                  clearSelectedStaff();
                  return;
                }
                setSelectedUserValue(value);
                const candidate = userLookup[value] ?? null;
                if (!candidate) {
                  toast.error('Unable to resolve selected staff. Please try again.');
                  return;
                }
                setSelectedCandidate(candidate);
                setSelectedMemberId(candidate.memberId || '');
                setSelectedAssignmentId(candidate.assignmentId || '');
                setTargetUserId(candidate.id);
                setManualRoleSelection(null);
                setManualOverrideRules(null);
                setOverrideRoleScope(null);
              }}
              placeholder={scopeSearchPlaceholder}
              emptyLabel={scopeSearchEmptyLabel}
              debounceMs={1000}
              loadOptions={scopeSearchReady ? loadUserOptions : async () => []}
            />
          </div>
        </div>
      </Card>

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
                <p className="mt-2 text-sm text-muted">Scope: {selectedScopeSummary}</p>
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
                    <div className="rounded border border-border p-3 text-sm text-muted">No roles found.</div>
                  ) : null}
                </div>
                <div className="mt-3">
                  <Button
                    loading={isScopedAccess ? updateMemberScopeAssignment.isPending : replaceRoles.isPending}
                    loadingText="Saving roles..."
                    disabled={isScopedAccess && !editableScopedAssignment}
                    onClick={async () => {
                      if (isScopedAccess) {
                        if (!editableScopedAssignment || !selectedMemberId) {
                          toast.error('Select a staff record with a direct assignment in the active scope.');
                          return;
                        }
                        await updateMemberScopeAssignment.mutateAsync({
                          orgId: organizationId,
                          memberId: selectedMemberId,
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
                      This staff record does not have a single direct assignment in the selected scope. Select the exact scope row or switch tabs.
                    </p>
                  ) : null}
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Specific Permissions (Can / Cannot)</CardTitle>
                    <CardDescription>
                      Cannot override takes precedence over role permissions. Role scope selection applies overrides to a specific role in the active {activeScopeType} scope.
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
                    <option value={ALL_ROLES_SCOPE}>
                      {isScopedAccess ? 'All assigned roles in this scope' : 'All assigned roles (global override)'}
                    </option>
                    {selectedRoleNames.map((roleName) => (
                      <option key={roleName} value={roleName}>
                        {roleName}
                      </option>
                    ))}
                  </select>
                </div>
                {activeScopedOverrideCount > 0 ? (
                  <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 p-3">
                    <p className="text-sm font-medium text-foreground">Specific permission overrides are active in this scope.</p>
                    <p className="mt-1 text-xs text-muted">
                      {activeScopedOverrideCount} override{activeScopedOverrideCount === 1 ? '' : 's'} currently change what this staff member can do.
                      These overrides take precedence over the role and can hide or expose interfaces even after you update the role.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-4">
                  <section className="space-y-2">
                    <h4 className="text-sm font-semibold text-foreground">Interface Access Permissions</h4>
                    {groupedInterfacePermissionRows.map((group) => (
                      <CollapsiblePermissionSection
                        key={group.label}
                        title={group.label}
                        totalCount={group.items.length}
                        activeCount={group.items.filter((permission) => Boolean(scopedOverrideMap[permission.key])).length}
                        contentClassName="space-y-2"
                      >
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
                      </CollapsiblePermissionSection>
                    ))}
                  </section>

                  {groupedOtherPermissionRows.length > 0 ? (
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold text-foreground">Other Action Permissions</h4>
                      {groupedOtherPermissionRows.map((group) => (
                        <CollapsiblePermissionSection
                          key={group.label}
                          title={group.label}
                          totalCount={group.items.length}
                          activeCount={group.items.filter((permission) => Boolean(scopedOverrideMap[permission.key])).length}
                          contentClassName="space-y-2"
                        >
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
                        </CollapsiblePermissionSection>
                      ))}
                    </section>
                  ) : null}

                  {interfacePermissionRows.length === 0 && otherPermissionRows.length === 0 ? (
                    <div className="rounded border border-border p-3 text-sm text-muted">No permissions matched your search.</div>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    loading={replaceOverrides.isPending}
                    loadingText="Saving permissions..."
                    disabled={isScopedAccess && !editableScopedAssignment}
                    onClick={async () => {
                      const overrides = overrideRules
                        .filter((entry) => entry.permissionKey && (entry.effect === 'allow' || entry.effect === 'deny'))
                        .map((entry) =>
                          entry.roleName
                            ? {
                                permissionKey: entry.permissionKey,
                                effect: entry.effect,
                                roleName: entry.roleName,
                                ...(entry.scopeType ? { scopeType: entry.scopeType } : {}),
                                ...(entry.institutionId ? { institutionId: entry.institutionId } : {}),
                                ...(entry.branchId ? { branchId: entry.branchId } : {}),
                              }
                            : {
                                permissionKey: entry.permissionKey,
                                effect: entry.effect,
                                ...(entry.scopeType ? { scopeType: entry.scopeType } : {}),
                                ...(entry.institutionId ? { institutionId: entry.institutionId } : {}),
                                ...(entry.branchId ? { branchId: entry.branchId } : {}),
                              });
                      await replaceOverrides.mutateAsync({
                        userId: targetUserId,
                        overrides,
                        organizationId,
                        scopeType: activeScopeType,
                        institutionId: effectiveInstitutionId ?? undefined,
                        branchId: effectiveBranchId ?? undefined,
                      });
                      setManualOverrideRules(null);
                      toast.success('Specific permissions updated');
                    }}
                  >
                    Save Specific Permissions
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={(isScopedAccess && !editableScopedAssignment) || activeScopedOverrideCount === 0 || replaceOverrides.isPending}
                    onClick={async () => {
                      await replaceOverrides.mutateAsync({
                        userId: targetUserId,
                        overrides: [],
                        organizationId,
                        scopeType: activeScopeType,
                        institutionId: effectiveInstitutionId ?? undefined,
                        branchId: effectiveBranchId ?? undefined,
                      });
                      setManualOverrideRules(null);
                      toast.success('Specific permissions reset to the role defaults');
                    }}
                  >
                    Reset To Role Defaults
                  </Button>
                </div>
                <div className="mt-2">
                  {isScopedAccess && !editableScopedAssignment ? (
                    <p className="text-xs text-muted">
                      Select a staff record with a direct assignment in the active scope to save scoped can/cannot overrides.
                    </p>
                  ) : null}
                </div>
              </Card>
            </>
          )}
        </>
      ) : null}

      <Modal open={showCreateRoleModal} onOpenChange={setShowCreateRoleModal} title="Create Role">
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
            <Input {...createRoleForm.register('description')} placeholder="Operations manager" />
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
