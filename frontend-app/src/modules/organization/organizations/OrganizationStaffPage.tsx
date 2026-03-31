import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, GitBranch, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ErrorState } from '@/components/feedback/ErrorState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { useOrgDetails, useOrgInstitutions, useScopedBranches } from '@/api/hooks/useInstitutions';
import {
  useAddOrganizationMember,
  useOrganizationMembers,
  useRemoveMemberScope,
  useRemoveOrganizationMember,
  type OrganizationMemberRow,
} from '@/api/hooks/useOrganizationStaff';
import { useOrgPermissions, useOrgRoles, useSaveOrgRole } from '@/api/hooks/useAccessControl';

const addStaffSchema = z.object({
  nin: z.string().regex(/^\d{11}$/, 'NIN must be 11 digits'),
  institutionId: z.string().optional(),
  branchId: z.string().optional(),
});
type AddStaffValues = z.infer<typeof addStaffSchema>;

const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(3, 'Description is required'),
});
type CreateRoleValues = z.infer<typeof createRoleSchema>;

const removalReasonOptions = [
  { value: 'transfer', label: 'Transfer' },
  { value: 'resignation', label: 'Resignation' },
  { value: 'sack', label: 'Sack' },
  { value: 'dismissal', label: 'Dismissal' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'redeployment', label: 'Redeployment' },
  { value: 'end_of_contract', label: 'End of Contract' },
  { value: 'disciplinary_action', label: 'Disciplinary Action' },
  { value: 'other', label: 'Other' },
] as const;

type RemoveTarget =
  | {
    scope: 'organization';
    memberId: string;
    memberName: string;
    roles: string[];
  }
  | {
    scope: 'assignment';
    memberId: string;
    memberName: string;
    assignmentId: string;
    scopeLabel: string;
  };

type NinLookupItem = {
  nin?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  otherName?: string | null;
};

export function OrganizationStaffPage() {
  const { orgId = '' } = useParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removalReason, setRemovalReason] = useState<string>('transfer');
  const [otherRemovalReason, setOtherRemovalReason] = useState('');
  const [removalInformation, setRemovalInformation] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [selectedRolePermissionKeys, setSelectedRolePermissionKeys] = useState<Set<string>>(new Set());

  const detailsQuery = useOrgDetails(orgId);
  const institutionsQuery = useOrgInstitutions(orgId);
  const branchesQuery = useScopedBranches({ page: 1, limit: 200, orgId, institutionId: institutionId || undefined });
  const membersQuery = useOrganizationMembers(orgId, {
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: q || undefined,
    status: status || undefined,
    institutionId: institutionId || undefined,
    branchId: branchId || undefined,
  });
  const addMember = useAddOrganizationMember();
  const removeMember = useRemoveOrganizationMember();
  const removeMemberScope = useRemoveMemberScope();
  const orgRolesQuery = useOrgRoles(orgId);
  const orgPermissionsQuery = useOrgPermissions(orgId);
  const saveOrgRole = useSaveOrgRole();
  const visibleMembers = membersQuery.data?.rows ?? [];

  const memberNameQuery = useQuery({
    queryKey: ['org', 'member-names', orgId, visibleMembers.map((entry) => entry.nin).join('|')],
    enabled: visibleMembers.length > 0,
    queryFn: async () => {
      const results = await Promise.all(visibleMembers.map(async (member) => {
        const nin = String(member.nin || '').trim();
        if (!nin) return null;
        const response = await apiClient.get<NinLookupItem>(endpoints.auth.ninLookup(nin), {
          suppressGlobalErrors: true,
        });
        const label = String(
          response.fullName
          || [response.firstName, response.otherName, response.lastName].filter(Boolean).join(' ')
          || '',
        ).trim();
        if (!label) return null;
        return [nin, label] as const;
      }));
      return new Map(results.filter((entry): entry is readonly [string, string] => Boolean(entry)));
    },
  });

  const form = useForm<AddStaffValues>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: {
      nin: '',
      institutionId: '',
      branchId: '',
    },
  });

  const createRoleForm = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '' },
  });

function openRemovalModal(target: RemoveTarget) {
    setRemoveTarget(target);
    setRemovalReason('transfer');
    setOtherRemovalReason('');
    setRemovalInformation('');
  }

  const institutionOptions = (institutionsQuery.data?.rows ?? []).map((entry) => ({
    value: entry.institutionId,
    label: `${entry.name} (${entry.code})`,
  }));
  const branchOptions = (branchesQuery.data?.rows ?? []).map((entry) => ({
    value: entry.branchId,
    label: `${entry.name} (${entry.code})`,
  }));
  const institutionLabelById = new Map((institutionsQuery.data?.rows ?? []).map((entry) => [entry.institutionId, entry.name] as const));
  const branchLabelById = new Map((branchesQuery.data?.rows ?? []).map((entry) => [entry.branchId, entry.name] as const));
  const currentRows = (membersQuery.data?.rows ?? []).filter((entry) => String(entry.status || '').toLowerCase() !== 'left');
  const leftRows = (membersQuery.data?.rows ?? []).filter((entry) => String(entry.status || '').toLowerCase() === 'left');

  const formatRoleName = (role: string) =>
    String(role || '')
      .trim()
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const formatRoleSummary = (roles: string[]) => {
    const items = Array.from(new Set((Array.isArray(roles) ? roles : []).map((role) => formatRoleName(role)).filter(Boolean)));
    return items.length > 0 ? items.join(', ') : null;
  };

  const renderScopeBlock = (
    entry: {
      key: string;
      label: string;
      removable?: boolean;
      assignmentId?: string;
      kind?: 'organization' | 'institution' | 'branch';
      rolesLabel?: string | null;
      institutionLabel?: string | null;
      branchLabel?: string | null;
    },
    row: OrganizationMemberRow,
  ) => {
    const icon = entry.kind === 'branch'
      ? <GitBranch className="h-4 w-4 text-primary" />
      : entry.kind === 'institution'
        ? <Building2 className="h-4 w-4 text-primary" />
        : <ShieldCheck className="h-4 w-4 text-primary" />;

    const scopeTitle = entry.kind === 'branch'
      ? 'Branch Scope'
      : entry.kind === 'institution'
        ? 'Institution Scope'
        : 'Organization Scope';

    const scopeMeta = entry.kind === 'branch'
      ? [entry.institutionLabel, entry.branchLabel].filter(Boolean).join(' / ')
      : entry.kind === 'institution'
        ? (entry.institutionLabel || null)
        : 'Full organization access';

    return (
      <div
        key={entry.key}
        className="rounded-xl border border-border/70 bg-gradient-to-br from-surface via-surface to-primary/5 px-3 py-2.5 shadow-subtle"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                {icon}
              </span>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{scopeTitle}</p>
                <p className="truncate text-[13px] font-semibold leading-tight text-foreground">{scopeMeta || entry.label}</p>
              </div>
            </div>
            {entry.rolesLabel ? (
              <div className="flex flex-wrap items-center gap-1.5 pl-[2.5rem] text-left">
                <Badge variant="info" className="rounded-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]">
                  {entry.rolesLabel}
                </Badge>
              </div>
            ) : null}
          </div>
          {entry.removable && entry.assignmentId ? (
            <PermissionGate permission="org.member.branch.remove">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-auto h-7 px-2.5 text-[11px]"
                loading={removeMemberScope.isPending}
                onClick={async () => {
                  const displayName = memberNameQuery.data?.get(row.original.nin) || row.original.nin;
                  openRemovalModal({
                    scope: 'assignment',
                    memberId: row.original.membershipId,
                    memberName: displayName,
                    assignmentId: entry.assignmentId,
                    scopeLabel: entry.label,
                  });
                }}
              >
                Remove Scope
              </Button>
            </PermissionGate>
          ) : null}
        </div>
      </div>
    );
  };

  const columns = useMemo<ColumnDef<OrganizationMemberRow>[]>(() => [
    { accessorKey: 'nin', header: 'NIN' },
    {
      id: 'fullName',
      header: 'Full Name',
      cell: ({ row }) => memberNameQuery.data?.get(row.original.nin) || row.original.nin,
    },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'scope',
      header: 'Access',
      cell: ({ row }) => {
        const scopeRows: Array<{
          key: string;
          label: string;
          removable: boolean;
          assignmentId?: string;
        }> = [];

        if (row.original.roles.length > 0) {
          const roleSummary = formatRoleSummary(row.original.roles);
          scopeRows.push({
            key: `org-${row.original.membershipId}`,
            label: roleSummary ? `Org Level / ${roleSummary}` : 'Org Level',
            removable: false,
            kind: 'organization',
            rolesLabel: roleSummary,
          });
        }

        for (const entry of row.original.assignments) {
          const roleSummary = formatRoleSummary(entry.roles);
          const resolvedInstitutionLabel = entry.institutionId
            ? institutionLabelById.get(entry.institutionId) || entry.institutionId
            : null;
          const resolvedBranchLabel = entry.branchId
            ? branchLabelById.get(entry.branchId) || entry.branchId
            : null;
          const scopeLabel = entry.branchId
            ? [
              'Institution',
              resolvedInstitutionLabel || 'Institution',
              'Branch',
              resolvedBranchLabel,
              roleSummary,
            ].filter(Boolean).join(' / ')
            : entry.institutionId
              ? [
                'Institution',
                resolvedInstitutionLabel,
                roleSummary,
              ].filter(Boolean).join(' / ')
              : (roleSummary ? `Org Level / ${roleSummary}` : 'Org Level');
          scopeRows.push({
            key: entry.assignmentId,
            label: scopeLabel,
            removable: true,
            assignmentId: entry.assignmentId,
            kind: entry.branchId ? 'branch' : entry.institutionId ? 'institution' : 'organization',
            rolesLabel: roleSummary,
            institutionLabel: resolvedInstitutionLabel,
            branchLabel: resolvedBranchLabel,
          });
        }

        if (scopeRows.length === 0) {
          scopeRows.push({
            key: `org-empty-${row.original.membershipId}`,
            label: 'Org Level',
            removable: false,
            kind: 'organization',
          });
        }

        return (
          <div className="space-y-2">
            {scopeRows.map((entry) => renderScopeBlock(entry, row.original))}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const displayName = memberNameQuery.data?.get(row.original.nin) || row.original.nin;
        const accessHref = row.original.userId
          ? `/app/org/access/staff/${row.original.userId}?scopeType=organization&memberId=${encodeURIComponent(row.original.membershipId)}&nin=${encodeURIComponent(row.original.nin)}&displayName=${encodeURIComponent(displayName)}`
          : null;
        return (
        <div className="flex gap-2">
          {row.original.userId && accessHref ? (
            <Button asChild size="sm" variant="outline">
              <Link to={accessHref}>Access</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>Access</Button>
          )}
          <PermissionGate permission="org.member.status.update">
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={row.original.roles.some((role) => String(role || '').trim().toLowerCase() === 'owner')}
              loading={removeMember.isPending}
              onClick={async () => {
                const displayName = memberNameQuery.data?.get(row.original.nin) || row.original.nin;
                openRemovalModal({
                  scope: 'organization',
                  memberId: row.original.membershipId,
                  memberName: displayName,
                  roles: row.original.roles,
                });
              }}
            >
              Remove Staff
            </Button>
          </PermissionGate>
        </div>
      );},
    },
  ], [branchLabelById, institutionLabelById, memberNameQuery.data, orgId, removeMember.isPending, removeMemberScope.isPending]);

  const leftColumns = useMemo<ColumnDef<OrganizationMemberRow>[]>(() => [
    { accessorKey: 'nin', header: 'NIN' },
    {
      id: 'fullName',
      header: 'Full Name',
      cell: ({ row }) => memberNameQuery.data?.get(row.original.nin) || row.original.nin,
    },
    { accessorKey: 'status', header: 'Status', cell: () => <StatusBadge status="left" /> },
    {
      id: 'scope',
      header: 'Former Access',
      cell: ({ row }) => {
        const scopeRows: Array<{ key: string; label: string }> = [];

        if (row.original.roles.length > 0) {
          const roleSummary = formatRoleSummary(row.original.roles);
          scopeRows.push({
            key: `org-${row.original.membershipId}`,
            label: roleSummary ? `Org Level / ${roleSummary}` : 'Org Level',
            kind: 'organization',
            rolesLabel: roleSummary,
          });
        }

        for (const entry of row.original.assignments) {
          const roleSummary = formatRoleSummary(entry.roles);
          const resolvedInstitutionLabel = entry.institutionId
            ? institutionLabelById.get(entry.institutionId) || entry.institutionId
            : null;
          const resolvedBranchLabel = entry.branchId
            ? branchLabelById.get(entry.branchId) || entry.branchId
            : null;
          const scopeLabel = entry.branchId
            ? [
              'Institution',
              resolvedInstitutionLabel || 'Institution',
              'Branch',
              resolvedBranchLabel,
              roleSummary,
            ].filter(Boolean).join(' / ')
            : entry.institutionId
              ? [
                'Institution',
                resolvedInstitutionLabel,
                roleSummary,
              ].filter(Boolean).join(' / ')
              : (roleSummary ? `Org Level / ${roleSummary}` : 'Org Level');
          scopeRows.push({
            key: entry.assignmentId,
            label: scopeLabel,
            kind: entry.branchId ? 'branch' : entry.institutionId ? 'institution' : 'organization',
            rolesLabel: roleSummary,
            institutionLabel: resolvedInstitutionLabel,
            branchLabel: resolvedBranchLabel,
          });
        }

        if (scopeRows.length === 0) {
          scopeRows.push({
            key: `org-empty-${row.original.membershipId}`,
            label: 'Org Level',
            kind: 'organization',
          });
        }

        return (
          <div className="space-y-2">
            {scopeRows.map((entry) => renderScopeBlock(entry, row.original))}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const displayName = memberNameQuery.data?.get(row.original.nin) || row.original.nin;
        const accessHref = row.original.userId
          ? `/app/org/access/staff/${row.original.userId}?scopeType=organization&memberId=${encodeURIComponent(row.original.membershipId)}&nin=${encodeURIComponent(row.original.nin)}&displayName=${encodeURIComponent(displayName)}`
          : null;
        return row.original.userId && accessHref ? (
          <Button asChild size="sm" variant="outline">
            <Link to={accessHref}>Access</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>Access</Button>
        );
      },
    },
  ], [branchLabelById, institutionLabelById, memberNameQuery.data, removeMemberScope.isPending]);

  const roleNameById = new Map((orgRolesQuery.data ?? []).map((entry) => [entry.id, entry.name] as const));
  const filteredRoles = (orgRolesQuery.data ?? []).filter((entry) => {
    const key = roleSearch.trim().toLowerCase();
    if (!key) return true;
    return `${entry.name} ${entry.description}`.toLowerCase().includes(key);
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const assignmentRoles = Array.from(selectedRoleIds)
      .map((roleId) => roleNameById.get(roleId))
      .filter((entry): entry is string => Boolean(entry));
    const hasScopedAssignment = Boolean(values.institutionId || values.branchId);

    await addMember.mutateAsync({
      orgId,
      nin: values.nin,
      initialRoles: hasScopedAssignment ? [] : assignmentRoles,
      initialAssignments: hasScopedAssignment
        ? [{
          institutionId: values.institutionId || undefined,
          branchId: values.branchId || undefined,
          roles: assignmentRoles,
        }]
        : [],
    });
    form.reset();
    setSelectedRoleIds(new Set());
    setShowAddModal(false);
  });

  if (!orgId) {
    return <ErrorState title="Organization not found" description="Invalid organization identifier." />;
  }

  if (detailsQuery.isError) {
    return <ErrorState title="Unable to resolve organization scope" description="Retry loading organization visibility scope." onRetry={() => detailsQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${detailsQuery.data?.organization?.name ?? 'Organization'} Staff`}
        description={detailsQuery.data?.viewerScope?.message || 'Staff visibility and assignment within this organization.'}
        breadcrumbs={[
          { label: 'Organization' },
          { label: 'Organizations', href: '/app/organizations' },
          { label: detailsQuery.data?.organization?.name ?? 'Organization', href: `/app/organizations/${orgId}` },
          { label: 'Staff' },
        ]}
        actions={(
          <PermissionGate permission="org.member.add">
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4" />
              Add Staff
            </Button>
          </PermissionGate>
        )}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search by NIN or user ID" />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={status}
            onChange={setStatus}
            placeholder="Status"
            loadOptions={async (input) => ['invited', 'active', 'suspended', 'left']
              .filter((entry) => entry.includes(input.toLowerCase()))
              .map((entry) => ({ value: entry, label: entry }))}
          />
        </div>
        <div className="w-full md:max-w-sm">
          <SmartSelect
            value={institutionId}
            onChange={(next) => {
              setInstitutionId(next);
              setBranchId(null);
            }}
            placeholder="Institution filter"
            loadOptions={async (input) =>
              institutionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
        </div>
        <div className="w-full md:max-w-sm">
          <SmartSelect
            value={branchId}
            onChange={setBranchId}
            placeholder="Branch filter"
            loadOptions={async (input) =>
              branchOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
        </div>
      </FilterBar>

      {membersQuery.isError ? (
        <ErrorState title="Unable to load organization staff" description="Retry loading staff records." onRetry={() => membersQuery.refetch()} />
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Current Staff</h2>
              <p className="text-sm text-muted">Staff currently active in this organization or its active scopes.</p>
            </div>
            <DataTable
              columns={columns}
              data={currentRows}
              total={currentRows.length}
              loading={membersQuery.isLoading}
              pagination={pagination}
              onPaginationChange={setPagination}
              pageCount={Math.max(1, Math.ceil(currentRows.length / pagination.pageSize))}
            />
          </section>
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Left Staff</h2>
              <p className="text-sm text-muted">Staff who have left this organization.</p>
            </div>
            <DataTable
              columns={leftColumns}
              data={leftRows}
              total={leftRows.length}
              loading={membersQuery.isLoading}
              pagination={pagination}
              onPaginationChange={setPagination}
              pageCount={Math.max(1, Math.ceil(leftRows.length / pagination.pageSize))}
            />
          </section>
        </div>
      )}

      <Modal open={showAddModal} onOpenChange={setShowAddModal} title="Add Organization Staff">
        <form className="space-y-3" onSubmit={onSubmit}>
          <FormField label="NIN">
            <Input {...form.register('nin')} placeholder="11-digit NIN" />
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Institution (optional)">
              <SmartSelect
                value={form.watch('institutionId') || null}
                onChange={(next) => form.setValue('institutionId', next || '', { shouldDirty: true })}
                placeholder="Select institution"
                loadOptions={async (input) =>
                  institutionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </FormField>
            <FormField label="Branch (optional)">
              <SmartSelect
                value={form.watch('branchId') || null}
                onChange={(next) => form.setValue('branchId', next || '', { shouldDirty: true })}
                placeholder="Select branch"
                loadOptions={async (input) =>
                  branchOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </FormField>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Assignment Roles</label>
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
            <SearchInput value={roleSearch} onChange={setRoleSearch} placeholder="Search organization roles" />
            <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-border p-2">
              {filteredRoles.map((role) => (
                <label key={role.id} className="flex items-center justify-between rounded border border-border px-2 py-1.5">
                  <span>
                    <span className="block text-sm font-medium text-foreground">{role.name}</span>
                    <span className="block text-xs text-muted">{role.description}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.has(role.id)}
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
              ))}
              {filteredRoles.length === 0 ? (
                <p className="text-xs text-muted">No organization roles found.</p>
              ) : null}
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button type="submit" loading={addMember.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={showCreateRoleModal} onOpenChange={setShowCreateRoleModal} title="Create Organization Role">
        <form
          className="space-y-3"
          onSubmit={createRoleForm.handleSubmit(async (values) => {
            try {
              await saveOrgRole.mutateAsync({
                name: values.name,
                description: values.description,
                permissions: Array.from(selectedRolePermissionKeys),
                organizationId: orgId,
              });
              const refreshed = await orgRolesQuery.refetch();
              const createdRole = (refreshed.data ?? []).find(
                (role) => role.name.trim().toLowerCase() === values.name.trim().toLowerCase(),
              );
              if (createdRole?.id) {
                setSelectedRoleIds((prev) => new Set(prev).add(createdRole.id));
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
            permissions={(orgPermissionsQuery.data ?? []).map((entry) => ({
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

      <Modal
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove Staff"
        description="Choose the scope and reason for removing this staff access so the history log remains meaningful."
      >
        {removeTarget ? (
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const payload = {
                orgId,
                memberId: removeTarget.memberId,
                reason: removalReason,
                otherReason: removalReason === 'other' ? otherRemovalReason.trim() : undefined,
                moreInformation: removalInformation.trim() || undefined,
              };

              if (removeTarget.scope === 'organization') {
                await removeMember.mutateAsync(payload);
                toast.success('Staff removed from organization scope');
              } else {
                await removeMemberScope.mutateAsync({
                  ...payload,
                  assignmentId: removeTarget.assignmentId,
                });
                toast.success('Staff removed from selected scope');
              }
              await membersQuery.refetch();
              setRemoveTarget(null);
            }}
          >
            <div className="rounded border border-border p-3 text-sm text-foreground">
              <p><span className="font-medium">Staff:</span> {removeTarget.memberName}</p>
              <p className="mt-1">
                <span className="font-medium">Scope:</span>{' '}
                {removeTarget.scope === 'organization' ? 'Organization' : removeTarget.scopeLabel}
              </p>
            </div>
            <FormField label="Reason">
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={removalReason}
                onChange={(event) => setRemovalReason(event.target.value)}
              >
                {removalReasonOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            {removalReason === 'other' ? (
              <FormField label="Custom Reason">
                <Input
                  value={otherRemovalReason}
                  onChange={(event) => setOtherRemovalReason(event.target.value)}
                  placeholder="Enter custom reason"
                />
              </FormField>
            ) : null}
            <FormField label="More Information">
              <textarea
                className="min-h-28 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={removalInformation}
                onChange={(event) => setRemovalInformation(event.target.value)}
                placeholder="Add more context for staff history"
              />
            </FormField>
            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
              <Button
                type="submit"
                variant="danger"
                disabled={removalReason === 'other' && otherRemovalReason.trim().length === 0}
                loading={removeMember.isPending || removeMemberScope.isPending}
              >
                Remove Staff
              </Button>
            </ModalFooter>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
