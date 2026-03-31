import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { apiClient } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { useInstitutionById, useScopedBranches } from '@/api/hooks/useInstitutions';
import { useAddOrganizationMember, useOrganizationMembers, useRemoveMemberScope, type OrganizationMemberRow } from '@/api/hooks/useOrganizationStaff';
import { useOrgPermissions, useOrgRoles, useSaveOrgRole } from '@/api/hooks/useAccessControl';

const schema = z.object({
  nin: z.string().regex(/^\d{11}$/),
  branchId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(3, 'Description is required'),
});
type CreateRoleValues = z.infer<typeof createRoleSchema>;

type RemoveTarget = {
  memberId: string;
  memberName: string;
  assignmentIds: string[];
  scopeLabel: string;
};

type NinLookupItem = {
  nin?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  otherName?: string | null;
};

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
];

function formatDateTime(value?: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

function formatReason(value?: string | null, otherValue?: string | null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'N/A';
  if (normalized === 'other') {
    return String(otherValue || '').trim() || 'Other';
  }
  return normalized
    .split(/[_\s-]+/)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
    .join(' ');
}

export function InstitutionStaffPage() {
  const { institutionId = '' } = useParams();
  const [q, setQ] = useState('');
  const [currentPagination, setCurrentPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [leftPagination, setLeftPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [branchId, setBranchId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [selectedRolePermissionKeys, setSelectedRolePermissionKeys] = useState<Set<string>>(new Set());
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removalReason, setRemovalReason] = useState<string>('transfer');
  const [otherRemovalReason, setOtherRemovalReason] = useState('');
  const [removalInformation, setRemovalInformation] = useState('');

  const institutionQuery = useInstitutionById(institutionId);
  const institution = institutionQuery.data?.institution ?? null;
  const orgId = institution?.organizationId;
  const branchesQuery = useScopedBranches({ page: 1, limit: 200, orgId, institutionId });
  const membersQuery = useOrganizationMembers(orgId, {
    page: currentPagination.pageIndex + 1,
    limit: currentPagination.pageSize,
    q: q || undefined,
    institutionId,
    branchId: branchId || undefined,
    assignmentStatus: 'active',
  });
  const leftMembersQuery = useOrganizationMembers(orgId, {
    page: leftPagination.pageIndex + 1,
    limit: leftPagination.pageSize,
    q: q || undefined,
    institutionId,
    branchId: branchId || undefined,
    assignmentStatus: 'inactive',
  });
  const addMember = useAddOrganizationMember();
  const removeMemberScope = useRemoveMemberScope();
  const orgRolesQuery = useOrgRoles(orgId);
  const orgPermissionsQuery = useOrgPermissions(orgId);
  const saveOrgRole = useSaveOrgRole();
  const currentRows = membersQuery.data?.rows ?? [];
  const currentMembershipIds = new Set(currentRows.map((entry) => entry.membershipId));
  const leftRows = (leftMembersQuery.data?.rows ?? []).filter((entry) => !currentMembershipIds.has(entry.membershipId));
  const visibleMembers = [...currentRows, ...leftRows];

  const memberNameQuery = useQuery({
    queryKey: ['institution', 'member-names', institutionId, visibleMembers.map((entry) => entry.nin).join('|')],
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

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { nin: '', branchId: '' },
  });
  const createRoleForm = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '' },
  });

  const openRemovalModal = (target: RemoveTarget) => {
    setRemoveTarget(target);
    setRemovalReason('transfer');
    setOtherRemovalReason('');
    setRemovalInformation('');
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
      id: 'roles',
      header: 'Roles',
      cell: ({ row }) => {
        const institutionRoles = Array.from(new Set(
          row.original.assignments
            .filter((entry) => String(entry.institutionId || '').trim() === institutionId)
            .flatMap((entry) => Array.isArray(entry.roles) ? entry.roles : [])
            .filter(Boolean),
        ));
        return <span className="text-sm text-foreground">{institutionRoles.join(', ') || 'N/A'}</span>;
      },
    },
    {
      id: 'dateAdded',
      header: 'Date Added',
      cell: ({ row }) => {
        const activeAssignment = row.original.assignments.find(
          (entry) => String(entry.institutionId || '').trim() === institutionId,
        );
        return <span className="text-sm text-foreground">{formatDateTime(activeAssignment?.activeFrom || row.original.createdAt)}</span>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const matchingAssignments = row.original.assignments.filter(
          (entry) => String(entry.institutionId || '').trim() === institutionId,
        );
        const institutionOnlyAssignment = matchingAssignments.find((entry) => !String(entry.branchId || '').trim());
        const branchScopedAssignment = !institutionOnlyAssignment && matchingAssignments.length === 1 ? matchingAssignments[0] : null;
        const displayName = memberNameQuery.data?.get(row.original.nin) || row.original.nin;
        const accessHref = row.original.userId
          ? institutionOnlyAssignment
            ? `/app/org/access/staff/${row.original.userId}?scopeType=institution&scopeId=${encodeURIComponent(institutionId)}&memberId=${encodeURIComponent(row.original.membershipId)}&assignmentId=${encodeURIComponent(institutionOnlyAssignment.assignmentId)}&nin=${encodeURIComponent(row.original.nin)}&displayName=${encodeURIComponent(displayName)}`
            : branchScopedAssignment
              ? `/app/org/access/staff/${row.original.userId}?scopeType=branch&scopeId=${encodeURIComponent(String(branchScopedAssignment.branchId || ''))}&institutionId=${encodeURIComponent(institutionId)}&memberId=${encodeURIComponent(row.original.membershipId)}&assignmentId=${encodeURIComponent(branchScopedAssignment.assignmentId)}&nin=${encodeURIComponent(row.original.nin)}&displayName=${encodeURIComponent(displayName)}`
              : `/app/org/access/staff/${row.original.userId}?scopeType=institution&scopeId=${encodeURIComponent(institutionId)}&memberId=${encodeURIComponent(row.original.membershipId)}&nin=${encodeURIComponent(row.original.nin)}&displayName=${encodeURIComponent(displayName)}`
          : null;
        return (
        <div className="flex gap-2">
          {row.original.userId && accessHref ? (
            <Button asChild size="sm" variant="outline">
              <Link to={accessHref}>Access</Link>
            </Button>
          ) : <Button size="sm" variant="outline" disabled>Access</Button>}
          <PermissionGate permission="org.member.branch.remove">
            <Button
              type="button"
              size="sm"
              variant="danger"
              loading={removeMemberScope.isPending}
              onClick={() => {
                const institutionAssignments = row.original.assignments.filter(
                  (entry) => String(entry.institutionId || '').trim() === institutionId,
                );
                if (institutionAssignments.length === 0) {
                  toast.error('No institution assignment found for this staff record');
                  return;
                }
                openRemovalModal({
                  memberId: row.original.membershipId,
                  memberName: row.original.nin,
                  assignmentIds: institutionAssignments.map((entry) => entry.assignmentId),
                  scopeLabel: `Institution: ${institution.name}`,
                });
              }}
            >
              Remove Staff
            </Button>
          </PermissionGate>
        </div>
      );
      },
    },
  ], [institution.name, institutionId, memberNameQuery.data, removeMemberScope.isPending]);

  const leftColumns = useMemo<ColumnDef<OrganizationMemberRow>[]>(() => [
    { accessorKey: 'nin', header: 'NIN' },
    {
      id: 'fullName',
      header: 'Full Name',
      cell: ({ row }) => memberNameQuery.data?.get(row.original.nin) || row.original.nin,
    },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status="left" /> },
    {
      id: 'roles',
      header: 'Roles',
      cell: ({ row }) => {
        const institutionRoles = Array.from(new Set(
          row.original.assignments
            .filter((entry) => String(entry.institutionId || '').trim() === institutionId)
            .flatMap((entry) => Array.isArray(entry.roles) ? entry.roles : [])
            .filter(Boolean),
        ));
        return <span className="text-sm text-foreground">{institutionRoles.join(', ') || 'N/A'}</span>;
      },
    },
    {
      id: 'dateLeft',
      header: 'Date Left',
      cell: ({ row }) => {
        const inactiveAssignment = row.original.assignments.find(
          (entry) => String(entry.institutionId || '').trim() === institutionId,
        );
        return <span className="text-sm text-foreground">{formatDateTime(inactiveAssignment?.removedAt || inactiveAssignment?.activeTo)}</span>;
      },
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: ({ row }) => {
        const inactiveAssignment = row.original.assignments.find(
          (entry) => String(entry.institutionId || '').trim() === institutionId,
        );
        return (
          <span className="text-sm text-foreground">
            {formatReason(inactiveAssignment?.removalReason, inactiveAssignment?.removalOtherReason)}
          </span>
        );
      },
    },
  ], [memberNameQuery.data]);

  const branchOptions = (branchesQuery.data?.rows ?? []).map((entry) => ({
    value: entry.branchId,
    label: `${entry.name} (${entry.code})`,
  }));

  if (!institutionId) return <ErrorState title="Institution not found" description="Invalid institution identifier." />;
  if (institutionQuery.isError) return <ErrorState title="Unable to load institution scope" description="Retry loading institution context." onRetry={() => institutionQuery.refetch()} />;
  if (!institution) return <ErrorState title="Institution not found" description="You may not have access to this institution." />;

  const roleNameById = new Map((orgRolesQuery.data ?? []).map((entry) => [entry.id, entry.name] as const));
  const filteredRoles = (orgRolesQuery.data ?? []).filter((entry) => {
    const key = roleSearch.trim().toLowerCase();
    if (!key) return true;
    return `${entry.name} ${entry.description}`.toLowerCase().includes(key);
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const roles = Array.from(selectedRoleIds)
      .map((roleId) => roleNameById.get(roleId))
      .filter((entry): entry is string => Boolean(entry));
    await addMember.mutateAsync({
      orgId: institution.organizationId,
      nin: values.nin,
      initialAssignments: [{
        institutionId: institution.institutionId,
        branchId: values.branchId || undefined,
        roles,
      }],
    });
    form.reset({ nin: '', branchId: '' });
    setSelectedRoleIds(new Set());
    setShowAddModal(false);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${institution.name} Staff`}
        description="Institution-level staff workspace."
        breadcrumbs={[
          { label: 'Organization' },
          { label: 'Institutions', href: '/app/institutions' },
          { label: institution.name, href: `/app/institutions/${institution.institutionId}` },
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
        <div className="w-full md:max-w-sm">
          <SmartSelect
            value={branchId}
            onChange={setBranchId}
            placeholder="Filter by branch"
            loadOptions={async (input) =>
              branchOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
        </div>
      </FilterBar>

      {membersQuery.isError ? (
        <ErrorState title="Unable to load institution staff" description="Retry loading institution staff records." onRetry={() => membersQuery.refetch()} />
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Current Staff</h2>
              <p className="text-sm text-muted">Staff currently assigned to this institution.</p>
            </div>
            <DataTable
              columns={columns}
              data={currentRows}
              total={currentRows.length}
              loading={membersQuery.isLoading}
              pagination={currentPagination}
              onPaginationChange={setCurrentPagination}
              pageCount={Math.max(1, Math.ceil(currentRows.length / currentPagination.pageSize))}
            />
          </section>
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Left Staff</h2>
              <p className="text-sm text-muted">Staff previously assigned to this institution and now removed from it.</p>
            </div>
            <DataTable
              columns={leftColumns}
              data={leftRows}
              total={leftRows.length}
              loading={leftMembersQuery.isLoading}
              pagination={leftPagination}
              onPaginationChange={setLeftPagination}
              pageCount={Math.max(1, Math.ceil(leftRows.length / leftPagination.pageSize))}
            />
          </section>
        </div>
      )}

      <Modal open={showAddModal} onOpenChange={setShowAddModal} title="Add Institution Staff">
        <form className="space-y-3" onSubmit={onSubmit}>
          <FormField label="NIN"><Input {...form.register('nin')} /></FormField>
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
              {filteredRoles.length === 0 ? <p className="text-xs text-muted">No organization roles found.</p> : null}
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
            if (!orgId) return;
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
            <Input {...createRoleForm.register('description')} placeholder="Institution operations manager" />
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
        description="Choose the reason for removing this staff from the institution so the history log stays clear."
      >
        {removeTarget ? (
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                for (const assignmentId of removeTarget.assignmentIds) {
                  await removeMemberScope.mutateAsync({
                    orgId: institution.organizationId,
                    memberId: removeTarget.memberId,
                    assignmentId,
                    reason: removalReason,
                    otherReason: removalReason === 'other' ? otherRemovalReason.trim() : undefined,
                    moreInformation: removalInformation.trim() || undefined,
                  });
                }
                await Promise.all([membersQuery.refetch(), leftMembersQuery.refetch()]);
                toast.success('Staff removed from institution');
                setRemoveTarget(null);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Unable to remove staff from institution');
              }
            }}
          >
            <div className="rounded border border-border p-3 text-sm text-foreground">
              <p><span className="font-medium">Staff:</span> {removeTarget.memberName}</p>
              <p className="mt-1"><span className="font-medium">Scope:</span> {removeTarget.scopeLabel}</p>
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
                loading={removeMemberScope.isPending}
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
