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
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useInstitutionById, useScopedBranches } from '@/api/hooks/useInstitutions';
import { useAddOrganizationMember, useOrganizationMembers, type OrganizationMemberRow } from '@/api/hooks/useOrganizationStaff';

const schema = z.object({
  nin: z.string().regex(/^\d{11}$/),
  branchId: z.string().optional(),
  rolesCsv: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function InstitutionStaffPage() {
  const { institutionId = '' } = useParams();
  const [q, setQ] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [branchId, setBranchId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const institutionQuery = useInstitutionById(institutionId);
  const institution = institutionQuery.data?.institution ?? null;
  const orgId = institution?.organizationId;
  const branchesQuery = useScopedBranches({ page: 1, limit: 200, orgId, institutionId });
  const membersQuery = useOrganizationMembers(orgId, {
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: q || undefined,
    institutionId,
    branchId: branchId || undefined,
  });
  const addMember = useAddOrganizationMember();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { nin: '', branchId: '', rolesCsv: '' },
  });

  const columns = useMemo<ColumnDef<OrganizationMemberRow>[]>(() => [
    { accessorKey: 'nin', header: 'NIN' },
    { accessorKey: 'userId', header: 'User ID', cell: ({ row }) => row.original.userId || 'Pending link' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'branches',
      header: 'Branches',
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.assignments.map((entry) => entry.branchId || 'institution').join(', ') || 'Institution only'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        row.original.userId ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/app/org/access/staff/${row.original.userId}`}>Access</Link>
          </Button>
        ) : <Button size="sm" variant="outline" disabled>Access</Button>
      ),
    },
  ], []);

  const branchOptions = (branchesQuery.data?.rows ?? []).map((entry) => ({
    value: entry.branchId,
    label: `${entry.name} (${entry.code})`,
  }));

  if (!institutionId) return <ErrorState title="Institution not found" description="Invalid institution identifier." />;
  if (institutionQuery.isError) return <ErrorState title="Unable to load institution scope" description="Retry loading institution context." onRetry={() => institutionQuery.refetch()} />;
  if (!institution) return <ErrorState title="Institution not found" description="You may not have access to this institution." />;

  const onSubmit = form.handleSubmit(async (values) => {
    const roles = String(values.rolesCsv || '').split(',').map((entry) => entry.trim()).filter(Boolean);
    await addMember.mutateAsync({
      orgId: institution.organizationId,
      nin: values.nin,
      initialAssignments: [{
        institutionId: institution.institutionId,
        branchId: values.branchId || undefined,
        roles,
      }],
    });
    form.reset({ nin: '', branchId: '', rolesCsv: '' });
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
          <FormField label="Assignment Roles (comma-separated)">
            <Input {...form.register('rolesCsv')} placeholder="nurse, pharmacist" />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button type="submit" loading={addMember.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
