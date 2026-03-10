import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ErrorState } from '@/components/feedback/ErrorState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useOrgDetails, useOrgInstitutions, useScopedBranches } from '@/api/hooks/useInstitutions';
import { useAddOrganizationMember, useAssignMemberScope, useOrganizationMembers, type OrganizationMemberRow } from '@/api/hooks/useOrganizationStaff';

const addStaffSchema = z.object({
  nin: z.string().regex(/^\d{11}$/, 'NIN must be 11 digits'),
  institutionId: z.string().optional(),
  branchId: z.string().optional(),
  assignmentRolesCsv: z.string().optional(),
});
type AddStaffValues = z.infer<typeof addStaffSchema>;

export function OrganizationStaffPage() {
  const { orgId = '' } = useParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [showAddModal, setShowAddModal] = useState(false);

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
  const assignScope = useAssignMemberScope();

  const form = useForm<AddStaffValues>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: {
      nin: '',
      institutionId: '',
      branchId: '',
      assignmentRolesCsv: '',
    },
  });

  const columns = useMemo<ColumnDef<OrganizationMemberRow>[]>(() => [
    { accessorKey: 'nin', header: 'NIN' },
    { accessorKey: 'userId', header: 'User ID', cell: ({ row }) => row.original.userId || 'Pending user link' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'scope',
      header: 'Scope Assignments',
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.assignments.length > 0 ? row.original.assignments.map((entry) => entry.branchId || entry.institutionId || 'org').join(', ') : 'Organization level'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          {row.original.userId ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`/app/org/access/staff/${row.original.userId}`}>Access</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>Access</Button>
          )}
        </div>
      ),
    },
  ], []);

  const institutionOptions = (institutionsQuery.data?.rows ?? []).map((entry) => ({
    value: entry.institutionId,
    label: `${entry.name} (${entry.code})`,
  }));
  const branchOptions = (branchesQuery.data?.rows ?? []).map((entry) => ({
    value: entry.branchId,
    label: `${entry.name} (${entry.code})`,
  }));

  const onSubmit = form.handleSubmit(async (values) => {
    const assignmentRoles = String(values.assignmentRolesCsv || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const created = await addMember.mutateAsync({
      orgId,
      nin: values.nin,
      initialAssignments: values.institutionId || values.branchId
        ? [{
          institutionId: values.institutionId || undefined,
          branchId: values.branchId || undefined,
          roles: assignmentRoles,
        }]
        : [],
    });

    const membershipId = String((created as { membership?: { membershipId?: string } })?.membership?.membershipId || '');
    if (membershipId && (values.institutionId || values.branchId)) {
      await assignScope.mutateAsync({
        orgId,
        memberId: membershipId,
        institutionId: values.institutionId || undefined,
        branchId: values.branchId || undefined,
        roles: assignmentRoles,
      });
    }
    form.reset();
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
        <DataTable
          columns={columns}
          data={membersQuery.data?.rows ?? []}
          total={membersQuery.data?.total ?? 0}
          loading={membersQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((membersQuery.data?.total ?? 0) / pagination.pageSize))}
        />
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
          <FormField label="Assignment Roles (comma-separated)">
            <Input {...form.register('assignmentRolesCsv')} placeholder="pharmacist, nurse, operations_manager" />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button type="submit" loading={addMember.isPending || assignScope.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
