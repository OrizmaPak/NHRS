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
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useBranchById } from '@/api/hooks/useInstitutions';
import { useAddOrganizationMember, useOrganizationMembers, type OrganizationMemberRow } from '@/api/hooks/useOrganizationStaff';

const schema = z.object({
  nin: z.string().regex(/^\d{11}$/),
  rolesCsv: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function BranchStaffPage() {
  const { branchId = '' } = useParams();
  const [q, setQ] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [showModal, setShowModal] = useState(false);

  const branchQuery = useBranchById(branchId);
  const branch = branchQuery.data?.branch ?? null;
  const membersQuery = useOrganizationMembers(branch?.organizationId, {
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: q || undefined,
    branchId: branch?.branchId,
  });
  const addMember = useAddOrganizationMember();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { nin: '', rolesCsv: '' },
  });

  const columns = useMemo<ColumnDef<OrganizationMemberRow>[]>(() => [
    { accessorKey: 'nin', header: 'NIN' },
    { accessorKey: 'userId', header: 'User ID', cell: ({ row }) => row.original.userId || 'Pending link' },
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
      cell: ({ row }) => (
        row.original.userId ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/app/org/access/staff/${row.original.userId}`}>Access</Link>
          </Button>
        ) : <Button size="sm" variant="outline" disabled>Access</Button>
      ),
    },
  ], []);

  if (!branchId) return <ErrorState title="Branch not found" description="Invalid branch identifier." />;
  if (branchQuery.isError) return <ErrorState title="Unable to load branch scope" description="Retry loading branch context." onRetry={() => branchQuery.refetch()} />;
  if (!branch) return <ErrorState title="Branch not found" description="You may not have access to this branch." />;

  const onSubmit = form.handleSubmit(async (values) => {
    const roles = String(values.rolesCsv || '').split(',').map((entry) => entry.trim()).filter(Boolean);
    await addMember.mutateAsync({
      orgId: branch.organizationId,
      nin: values.nin,
      initialAssignments: [{
        institutionId: branch.institutionId,
        branchId: branch.branchId,
        roles,
      }],
    });
    form.reset({ nin: '', rolesCsv: '' });
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

      <Modal open={showModal} onOpenChange={setShowModal} title="Add Branch Staff">
        <form className="space-y-3" onSubmit={onSubmit}>
          <FormField label="NIN"><Input {...form.register('nin')} /></FormField>
          <FormField label="Branch Roles (comma-separated)">
            <Input {...form.register('rolesCsv')} placeholder="pharmacist, cashier, nurse" />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={addMember.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
