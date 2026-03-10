import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { useContextStore } from '@/stores/contextStore';
import { useOrgPermissions, useSaveOrgPermission, useUpdateOrgPermission, type PermissionRow } from '@/api/hooks/useAccessControl';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';

const formSchema = z.object({
  key: z.string().min(3, 'Permission key is required'),
  module: z.string().min(2, 'Module is required'),
  description: z.string().min(4, 'Description is required'),
});

type FormValues = z.infer<typeof formSchema>;

export function OrgPermissionsPage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const organizationId = getOrganizationIdFromContext(activeContext);

  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PermissionRow | null>(null);

  const permissionsQuery = useOrgPermissions(organizationId);
  const savePermission = useSaveOrgPermission();
  const updatePermission = useUpdateOrgPermission();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { key: '', module: '', description: '' },
  });

  const filtered = useMemo(() => {
    const rows = permissionsQuery.data ?? [];
    if (!query.trim()) return rows;
    const key = query.toLowerCase();
    return rows.filter((entry) => `${entry.key} ${entry.module} ${entry.description}`.toLowerCase().includes(key));
  }, [permissionsQuery.data, query]);
  const start = pagination.pageIndex * pagination.pageSize;
  const paged = filtered.slice(start, start + pagination.pageSize);

  const columns = useMemo<ColumnDef<PermissionRow>[]>(
    () => [
      { accessorKey: 'key', header: 'Permission Key' },
      { accessorKey: 'module', header: 'Module' },
      { accessorKey: 'description', header: 'Description' },
      { accessorKey: 'createdAt', header: 'Created At' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(row.original);
                form.reset({ key: row.original.key, module: row.original.module, description: row.original.description });
                setModalOpen(true);
              }}
            >
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [form],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    if (editing) {
      await updatePermission.mutateAsync({ ...values, organizationId });
      toast.success('Permission updated');
    } else {
      await savePermission.mutateAsync({ ...values, organizationId });
      toast.success('Permission created');
    }
    setModalOpen(false);
  });

  if (!organizationId) {
    return <ErrorState title="Organization context required" description="Switch to an organization context to manage organization permissions." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Permissions"
        description="Define and maintain organization-scoped permission keys."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Access Control' }, { label: 'Permissions' }]}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              form.reset({ key: '', module: '', description: '' });
              setModalOpen(true);
            }}
          >
            Create Org Permission
          </Button>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search organization permissions" />
        </div>
      </FilterBar>

      {permissionsQuery.isError ? (
        <ErrorState title="Unable to load organization permissions" description="Please retry." onRetry={() => permissionsQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={paged}
          total={filtered.length}
          loading={permissionsQuery.isLoading || savePermission.isPending || updatePermission.isPending}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(filtered.length / pagination.pageSize))}
        />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Org Permission' : 'Create Org Permission'} description="These permissions apply only within this organization scope.">
        <form className="space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Permission Key</label>
            <Input {...form.register('key')} disabled={Boolean(editing)} placeholder="org.member.read" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Module</label>
            <Input {...form.register('module')} placeholder="membership" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Description</label>
            <Input {...form.register('description')} placeholder="Read organization staff members" />
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? 'Save Changes' : 'Create Permission'}</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
