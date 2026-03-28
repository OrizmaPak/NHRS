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
import { useAppPermissions, useSaveAppPermission, useUpdateAppPermission, type PermissionRow } from '@/api/hooks/useAccessControl';
import { getPermissionDisplayMeta } from '@/lib/interfacePermissions';

const formSchema = z.object({
  key: z.string().min(3, 'Permission key is required'),
  module: z.string().min(2, 'Module is required'),
  description: z.string().min(4, 'Description is required'),
});

type FormValues = z.infer<typeof formSchema>;

export function AppPermissionsPage() {
  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PermissionRow | null>(null);

  const permissionsQuery = useAppPermissions();
  const savePermission = useSaveAppPermission();
  const updatePermission = useUpdateAppPermission();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { key: '', module: '', description: '' },
  });

  const filtered = useMemo(() => {
    const rows = permissionsQuery.data ?? [];
    if (!query.trim()) return rows;
    const key = query.toLowerCase();
    return rows.filter((entry) => {
      const meta = getPermissionDisplayMeta(entry);
      return `${entry.key} ${entry.module} ${entry.description} ${meta.title} ${meta.groupLabel} ${meta.actionLabel} ${meta.interfaceSummary ?? ''}`.toLowerCase().includes(key);
    });
  }, [permissionsQuery.data, query]);
  const start = pagination.pageIndex * pagination.pageSize;
  const paged = filtered.slice(start, start + pagination.pageSize);

  const columns = useMemo<ColumnDef<PermissionRow>[]>(
    () => [
      {
        id: 'permission',
        header: 'Permission',
        cell: ({ row }) => {
          const meta = getPermissionDisplayMeta(row.original);
          return (
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{meta.title}</p>
              <p className="text-[11px] text-muted">{row.original.key}</p>
            </div>
          );
        },
      },
      {
        id: 'area',
        header: 'Area',
        cell: ({ row }) => getPermissionDisplayMeta(row.original).groupLabel,
      },
      { accessorKey: 'description', header: 'Description' },
      {
        id: 'interface',
        header: 'Used In',
        cell: ({ row }) => {
          const meta = getPermissionDisplayMeta(row.original);
          if (!meta.interfaceSummary) return <span className="text-xs text-muted">Custom action only</span>;
          return (
            <div className="max-w-[300px] space-y-1">
              <p className="text-xs font-medium text-foreground">{meta.interfaceSummary}</p>
              {meta.routeSummary ? <p className="truncate text-[11px] text-muted">{meta.routeSummary}</p> : null}
              {meta.interfaceCount > 2 ? (
                <p className="text-[11px] text-muted">+{meta.interfaceCount - 2} more interfaces</p>
              ) : null}
            </div>
          );
        },
      },
      { accessorKey: 'scope', header: 'Scope' },
      { accessorKey: 'createdAt', header: 'Created At' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(row.original);
                form.reset({
                  key: row.original.key,
                  module: row.original.module,
                  description: row.original.description,
                });
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

  const openCreate = () => {
    setEditing(null);
    form.reset({ key: '', module: '', description: '' });
    setModalOpen(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (editing) {
      await updatePermission.mutateAsync(values);
      toast.success('Permission updated');
    } else {
      await savePermission.mutateAsync(values);
      toast.success('Permission created');
    }
    setModalOpen(false);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="App Permissions"
        description="Manage global platform permission keys and module-level capabilities."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Access Control' }, { label: 'App Permissions' }]}
        actions={<Button onClick={openCreate}>Create Permission</Button>}
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by page, action, area, or permission key" />
        </div>
      </FilterBar>

      {permissionsQuery.isError ? (
        <ErrorState title="Unable to load app permissions" description="Please retry." onRetry={() => permissionsQuery.refetch()} />
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

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? 'Edit Permission' : 'Create Permission'}
        description="Permission keys should be stable and module-scoped."
      >
        <form className="space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Permission Key</label>
            <Input {...form.register('key')} disabled={Boolean(editing)} placeholder="records.read" />
            {form.formState.errors.key ? <p className="mt-1 text-xs text-danger">{form.formState.errors.key.message}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Module</label>
            <Input {...form.register('module')} placeholder="records" />
            {form.formState.errors.module ? <p className="mt-1 text-xs text-danger">{form.formState.errors.module.message}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Description</label>
            <Input {...form.register('description')} placeholder="Read patient records" />
            {form.formState.errors.description ? <p className="mt-1 text-xs text-danger">{form.formState.errors.description.message}</p> : null}
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              loading={savePermission.isPending || updatePermission.isPending}
              loadingText={editing ? 'Saving changes...' : 'Creating permission...'}
            >
              {editing ? 'Save Changes' : 'Create Permission'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
