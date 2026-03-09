import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { useAppPermissions, useAppRoles, useDeleteAppRole, useSaveAppRole, type RoleRow } from '@/api/hooks/useAccessControl';

const roleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(4, 'Description is required'),
});

type RoleValues = z.infer<typeof roleSchema>;

const isLockedRole = (role: Pick<RoleRow, 'name'> | null | undefined) =>
  String(role?.name ?? '').trim().toLowerCase() === 'super';

const canDeleteRole = (role: RoleRow) => {
  const roleName = String(role.name || '').trim().toLowerCase();
  if (roleName === 'citizen' || roleName === 'super') return false;
  return String(role.id || '').trim().length > 0;
};

export function AppRolesPage() {
  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [permissionSetupMode, setPermissionSetupMode] = useState<'manual' | 'inherit'>('manual');
  const [inheritRoleId, setInheritRoleId] = useState('');
  const [selectedRole, setSelectedRole] = useState<RoleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);

  const rolesQuery = useAppRoles();
  const permissionsQuery = useAppPermissions();
  const saveRole = useSaveAppRole();
  const deleteRole = useDeleteAppRole();

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
  const inheritableRoles = useMemo(
    () => (rolesQuery.data ?? []).filter((role) => role.id !== editing?.id && !isLockedRole(role)),
    [editing?.id, rolesQuery.data],
  );

  const columns = useMemo<ColumnDef<RoleRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Role Name' },
      { accessorKey: 'description', header: 'Description' },
      { id: 'permissionCount', header: 'Permission Count', cell: ({ row }) => row.original.permissions.length },
      { accessorKey: 'createdAt', header: 'Created At' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelectedRole(row.original)}>
              View
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isLockedRole(row.original)}
              onClick={() => {
                if (isLockedRole(row.original)) {
                  toast.error('Super role is locked and cannot be edited.');
                  return;
                }
                setEditing(row.original);
                form.reset({ name: row.original.name, description: row.original.description });
                setSelectedPermissions(new Set(row.original.permissions));
                setPermissionSetupMode('manual');
                setInheritRoleId('');
                setModalOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canDeleteRole(row.original)}
              onClick={() => setDeleteTarget(row.original)}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [form],
  );

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: '', description: '' });
    setSelectedPermissions(new Set());
    setPermissionSetupMode('manual');
    setInheritRoleId('');
    setModalOpen(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (String(values.name || '').trim().toLowerCase() === 'super') {
      toast.error('Super role is locked and cannot be created or modified.');
      return;
    }
    await saveRole.mutateAsync({
      id: editing?.id,
      name: values.name,
      description: values.description,
      permissions: Array.from(selectedPermissions),
    });
    toast.success(editing ? 'Role updated' : 'Role created');
    setModalOpen(false);
  });

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (!canDeleteRole(deleteTarget)) {
      toast.error('This role cannot be deleted.');
      setDeleteTarget(null);
      return;
    }
    try {
      await deleteRole.mutateAsync(deleteTarget.id);
      toast.success(`Role "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      setSelectedRole((current) => (current?.id === deleteTarget.id ? null : current));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete role';
      toast.error(message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="App Roles"
        description="Manage global platform roles and permission assignments."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Access Control' }, { label: 'App Roles' }]}
        actions={<Button onClick={openCreate}>Create Role</Button>}
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search roles" />
        </div>
      </FilterBar>

      {rolesQuery.isError ? (
        <ErrorState title="Unable to load app roles" description="Please retry." onRetry={() => rolesQuery.refetch()} />
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

      {selectedRole ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Role Details - {selectedRole.name}</CardTitle>
              <CardDescription>{selectedRole.description}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelectedRole(null)}>Close</Button>
          </CardHeader>
          <div className="flex flex-wrap gap-2">
            {selectedRole.permissions.map((entry) => (
              <span key={entry} className="rounded border border-border px-2 py-1 text-xs text-foreground">
                {entry}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? 'Edit App Role' : 'Create App Role'}
        description="Assign role metadata and permissions using the matrix."
        contentClassName="w-[min(920px,96vw)]"
      >
        <form className="space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Role Name</label>
            <Input {...form.register('name')} placeholder="custom_role_name" />
            {form.formState.errors.name ? <p className="mt-1 text-xs text-danger">{form.formState.errors.name.message}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Description</label>
            <Input {...form.register('description')} placeholder="Global administrator role" />
            {form.formState.errors.description ? <p className="mt-1 text-xs text-danger">{form.formState.errors.description.message}</p> : null}
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Permission Setup</p>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="permissionSetupMode"
                  checked={permissionSetupMode === 'manual'}
                  onChange={() => {
                    setPermissionSetupMode('manual');
                    setInheritRoleId('');
                  }}
                />
                <span>Set permissions manually</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="permissionSetupMode"
                  checked={permissionSetupMode === 'inherit'}
                  onChange={() => setPermissionSetupMode('inherit')}
                />
                <span>Inherit permissions</span>
              </label>
            </div>
            {permissionSetupMode === 'inherit' ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Inherit From Role</label>
                  <select
                    value={inheritRoleId}
                    onChange={(event) => {
                      const nextRoleId = event.target.value;
                      setInheritRoleId(nextRoleId);
                      const sourceRole = inheritableRoles.find((role) => role.id === nextRoleId);
                      if (sourceRole) {
                        setSelectedPermissions(new Set(sourceRole.permissions));
                      }
                    }}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  >
                    <option value="">Select role to inherit from</option>
                    {inheritableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name} ({role.permissions.length} permissions)
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!inheritRoleId) return;
                    const sourceRole = inheritableRoles.find((role) => role.id === inheritRoleId);
                    if (!sourceRole) return;
                    setSelectedPermissions(new Set(sourceRole.permissions));
                    toast.success(`Inherited permissions from "${sourceRole.name}"`);
                  }}
                  disabled={!inheritRoleId}
                >
                  Re-apply Inheritance
                </Button>
              </div>
            ) : null}
          </div>
          <PermissionMatrix
            permissions={(permissionsQuery.data ?? []).map((entry) => ({
              key: entry.key,
              module: entry.module,
              description: entry.description,
            }))}
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
            <Button type="submit" loading={saveRole.isPending} loadingText={editing ? 'Saving role...' : 'Creating role...'}>
              {editing ? 'Save Role' : 'Create Role'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete App Role"
        description="Are you sure you want to delete this role? It cannot be retrieved once deleted."
      >
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Role:
            {' '}
            <span className="font-semibold">{deleteTarget?.name}</span>
          </p>
          <p className="text-sm text-muted">
            This action removes the role definition and may affect access for users currently assigned to it.
          </p>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deleteRole.isPending}
              loadingText="Deleting..."
              onClick={handleConfirmDelete}
            >
              Yes, Delete Role
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
}
