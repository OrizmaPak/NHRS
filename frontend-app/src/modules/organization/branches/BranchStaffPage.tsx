import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
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
import { useBranchById } from '@/api/hooks/useInstitutions';
import { useAddOrganizationMember, useOrganizationMembers, type OrganizationMemberRow } from '@/api/hooks/useOrganizationStaff';
import { useOrgPermissions, useOrgRoles, useSaveOrgRole } from '@/api/hooks/useAccessControl';

const schema = z.object({
  nin: z.string().regex(/^\d{11}$/),
});
type Values = z.infer<typeof schema>;

const createRoleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(3, 'Description is required'),
});
type CreateRoleValues = z.infer<typeof createRoleSchema>;

type NinLookupItem = {
  nin?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  otherName?: string | null;
};

export function BranchStaffPage() {
  const { branchId = '' } = useParams();
  const [q, setQ] = useState('');
  const [currentPagination, setCurrentPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [leftPagination, setLeftPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [showModal, setShowModal] = useState(false);
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [selectedRolePermissionKeys, setSelectedRolePermissionKeys] = useState<Set<string>>(new Set());

  const branchQuery = useBranchById(branchId);
  const branch = branchQuery.data?.branch ?? null;
  const membersQuery = useOrganizationMembers(branch?.organizationId, {
    page: currentPagination.pageIndex + 1,
    limit: currentPagination.pageSize,
    q: q || undefined,
    branchId: branch?.branchId,
    assignmentStatus: 'active',
  });
  const leftMembersQuery = useOrganizationMembers(branch?.organizationId, {
    page: leftPagination.pageIndex + 1,
    limit: leftPagination.pageSize,
    q: q || undefined,
    branchId: branch?.branchId,
    assignmentStatus: 'inactive',
  });
  const addMember = useAddOrganizationMember();
  const orgRolesQuery = useOrgRoles(branch?.organizationId);
  const orgPermissionsQuery = useOrgPermissions(branch?.organizationId);
  const saveOrgRole = useSaveOrgRole();
  const visibleMembers = [...(membersQuery.data?.rows ?? []), ...(leftMembersQuery.data?.rows ?? [])];

  const memberNameQuery = useQuery({
    queryKey: ['branch', 'member-names', branchId, visibleMembers.map((entry) => entry.nin).join('|')],
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
    defaultValues: { nin: '' },
  });
  const createRoleForm = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: '', description: '' },
  });

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
      header: 'Branch Roles',
      cell: ({ row }) => {
        const branchRoles = row.original.assignments
          .flatMap((entry) => entry.roles)
          .filter(Boolean);
        return <span className="text-sm text-foreground">{branchRoles.join(', ') || 'N/A'}</span>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const scopeAssignment = row.original.assignments.find((entry) => String(entry.branchId || '').trim() === branch.branchId);
        const accessHref = scopeAssignment
          ? `/app/org/access/staff/${row.original.userId}?scopeType=branch&scopeId=${encodeURIComponent(branch.branchId)}&institutionId=${encodeURIComponent(branch.institutionId)}&memberId=${encodeURIComponent(row.original.membershipId)}&assignmentId=${encodeURIComponent(scopeAssignment.assignmentId)}`
          : `/app/org/access/staff/${row.original.userId}?scopeType=branch&scopeId=${encodeURIComponent(branch.branchId)}&institutionId=${encodeURIComponent(branch.institutionId)}&memberId=${encodeURIComponent(row.original.membershipId)}`;
        return row.original.userId ? (
          <Button asChild size="sm" variant="outline">
            <Link to={accessHref}>Access</Link>
          </Button>
        ) : <Button size="sm" variant="outline" disabled>Access</Button>
      },
    },
  ], [branch.branchId, branch.institutionId, memberNameQuery.data]);

  const leftColumns = useMemo<ColumnDef<OrganizationMemberRow>[]>(() => [
    { accessorKey: 'nin', header: 'NIN' },
    {
      id: 'fullName',
      header: 'Full Name',
      cell: ({ row }) => memberNameQuery.data?.get(row.original.nin) || row.original.nin,
    },
    { accessorKey: 'status', header: 'Status', cell: () => <StatusBadge status="left" /> },
    {
      id: 'roles',
      header: 'Former Branch Roles',
      cell: ({ row }) => {
        const branchRoles = row.original.assignments.flatMap((entry) => entry.roles).filter(Boolean);
        return <span className="text-sm text-foreground">{branchRoles.join(', ') || 'N/A'}</span>;
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const scopeAssignment = row.original.assignments.find((entry) => String(entry.branchId || '').trim() === branch.branchId);
        const accessHref = scopeAssignment
          ? `/app/org/access/staff/${row.original.userId}?scopeType=branch&scopeId=${encodeURIComponent(branch.branchId)}&institutionId=${encodeURIComponent(branch.institutionId)}&memberId=${encodeURIComponent(row.original.membershipId)}&assignmentId=${encodeURIComponent(scopeAssignment.assignmentId)}`
          : `/app/org/access/staff/${row.original.userId}?scopeType=branch&scopeId=${encodeURIComponent(branch.branchId)}&institutionId=${encodeURIComponent(branch.institutionId)}&memberId=${encodeURIComponent(row.original.membershipId)}`;
        return row.original.userId ? (
          <Button asChild size="sm" variant="outline">
            <Link to={accessHref}>Access</Link>
          </Button>
        ) : <Button size="sm" variant="outline" disabled>Access</Button>
      },
    },
  ], [branch.branchId, branch.institutionId, memberNameQuery.data]);

  if (!branchId) return <ErrorState title="Branch not found" description="Invalid branch identifier." />;
  if (branchQuery.isError) return <ErrorState title="Unable to load branch scope" description="Retry loading branch context." onRetry={() => branchQuery.refetch()} />;
  if (!branch) return <ErrorState title="Branch not found" description="You may not have access to this branch." />;

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
      orgId: branch.organizationId,
      nin: values.nin,
      initialAssignments: [{
        institutionId: branch.institutionId,
        branchId: branch.branchId,
        roles,
      }],
    });
    form.reset({ nin: '' });
    setSelectedRoleIds(new Set());
    setShowModal(false);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${branch.name} Staff`}
        description="Branch-scoped staff workspace."
        breadcrumbs={[
          { label: 'Organization' },
          { label: 'Branches', href: '/app/branches' },
          { label: branch.name, href: `/app/branches/${branch.branchId}` },
          { label: 'Staff' },
        ]}
        actions={(
          <PermissionGate permission="org.member.add">
            <Button onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4" />
              Add Branch Staff
            </Button>
          </PermissionGate>
        )}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search by NIN or user ID" />
        </div>
      </FilterBar>

      {membersQuery.isError ? (
        <ErrorState title="Unable to load branch staff" description="Retry loading branch staff records." onRetry={() => membersQuery.refetch()} />
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Current Staff</h2>
              <p className="text-sm text-muted">Staff currently assigned to this branch.</p>
            </div>
            <DataTable
              columns={columns}
              data={membersQuery.data?.rows ?? []}
              total={membersQuery.data?.total ?? 0}
              loading={membersQuery.isLoading}
              pagination={currentPagination}
              onPaginationChange={setCurrentPagination}
              pageCount={Math.max(1, Math.ceil((membersQuery.data?.total ?? 0) / currentPagination.pageSize))}
            />
          </section>
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Left Staff</h2>
              <p className="text-sm text-muted">Staff previously assigned to this branch and now removed from it.</p>
            </div>
            <DataTable
              columns={leftColumns}
              data={leftMembersQuery.data?.rows ?? []}
              total={leftMembersQuery.data?.total ?? 0}
              loading={leftMembersQuery.isLoading}
              pagination={leftPagination}
              onPaginationChange={setLeftPagination}
              pageCount={Math.max(1, Math.ceil((leftMembersQuery.data?.total ?? 0) / leftPagination.pageSize))}
            />
          </section>
        </div>
      )}

      <Modal open={showModal} onOpenChange={setShowModal} title="Add Branch Staff">
        <form className="space-y-3" onSubmit={onSubmit}>
          <FormField label="NIN"><Input {...form.register('nin')} /></FormField>
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
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={addMember.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={showCreateRoleModal} onOpenChange={setShowCreateRoleModal} title="Create Organization Role">
        <form
          className="space-y-3"
          onSubmit={createRoleForm.handleSubmit(async (values) => {
            if (!branch?.organizationId) return;
            try {
              await saveOrgRole.mutateAsync({
                name: values.name,
                description: values.description,
                permissions: Array.from(selectedRolePermissionKeys),
                organizationId: branch.organizationId,
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
            <Input {...createRoleForm.register('name')} placeholder="branch_operations" />
          </FormField>
          <FormField label="Description">
            <Input {...createRoleForm.register('description')} placeholder="Branch operations role" />
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
    </div>
  );
}
