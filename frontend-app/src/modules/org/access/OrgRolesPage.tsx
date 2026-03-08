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
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useContextStore } from '@/stores/contextStore';
import { useDeleteOrgRole, useOrgPermissions, useOrgRoles, useSaveOrgRole, type RoleRow } from '@/api/hooks/useAccessControl';

const roleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(4, 'Description is required'),
});
type RoleValues = z.infer<typeof roleSchema>;

export function OrgRolesPage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const organizationId = activeContext?.type === 'organization' ? (activeContext.organizationId || activeContext.id) : undefined;

  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());

  const rolesQuery = useOrgRoles(organizationId);
  const permissionsQuery = useOrgPermissions(organizationId);
  const saveRole = useSaveOrgRole();
  const deleteRole = useDeleteOrgRole();

  const form = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: '', description: '' },
  });

  const roles = useMemo(() => {
    const rows = rolesQuery.data ?? [];
    if (!query.trim()) return rows;
    const key = query.toLowerCase();
    return rows.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(key));
  }, [rolesQuery.data, query]);
  const start = pagination.pageIndex * pagination.pageSize;
  const paged = roles.slice(start, start + pagination.pageSize);

  const columns = useMemo<ColumnDef<RoleRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Role Name' },
      { accessorKey: 'description', header: 'Description' },
      { id: 'permissionCount', header: 'Permission Count', cell: ({ row }) => row.original.permissions.length },
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
                form.reset({ name: row.original.name, description: row.original.description });
                setSelectedPermissions(new Set(row.original.permissions));
                setModalOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await deleteRole.mutateAsync({ id: row.original.id, organizationId });
                toast.success('Role deleted');
              }}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [deleteRole, form, organizationId],
  );

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: '', description: '' });
    setSelectedPermissions(new Set());
    setModalOpen(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    await saveRole.mutateAsync({
      id: editing?.id,
      name: values.name,
      description: values.description,
      permissions: Array.from(selectedPermissions),
      organizationId,
    });
    toast.success(editing ? 'Role updated' : 'Role created');
    setModalOpen(false);
  });

  if (!organizationId) {
    return <ErrorState title="Organization context required" description="Switch to an organization context to manage organization roles." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Roles"
        description="Manage role definitions and permission bundles scoped to the active organization."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Access Control' }, { label: 'Roles' }]}
        actions={<Button onClick={openCreate}>Create Org Role</Button>}
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search organization roles" />
        </div>
      </FilterBar>

      {rolesQuery.isError ? (
        <ErrorState title="Unable to load organization roles" description="Please retry." onRetry={() => rolesQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={paged}
          total={roles.length}
          loading={rolesQuery.isLoading || saveRole.isPending || deleteRole.isPending}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(roles.length / pagination.pageSize))}
        />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit Organization Role' : 'Create Organization Role'} description="Assign permissions through the matrix UI.">
        <form className="space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Role Name</label>
            <Input {...form.register('name')} placeholder="org_manager" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Description</label>
            <Input {...form.register('description')} placeholder="Organization manager role" />
          </div>
          <PermissionMatrix
            permissions={(permissionsQuery.data ?? []).map((entry) => ({ key: entry.key, module: entry.module, description: entry.description }))}
            selected={selectedPermissions}
            onToggle={(key, checked) =>
              setSelectedPermissions((prev) => {
                const next = new Set(prev);
                if (checked) next.add(key);
                else next.delete(key);
                return next;
              })
            }
          />
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saveRole.isPending}>{editing ? 'Save Role' : 'Create Role'}</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
