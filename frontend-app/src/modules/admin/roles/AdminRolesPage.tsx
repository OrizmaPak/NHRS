import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useAdminRoles, useSaveAdminRole, type AdminRole } from '@/api/hooks/useAdminRoles';

const roleSchema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().min(4, 'Description is required'),
  permissions: z.string().min(1, 'At least one permission is required'),
});

type RoleFormValues = z.infer<typeof roleSchema>;

export function AdminRolesPage() {
  const rolesQuery = useAdminRoles();
  const saveRole = useSaveAdminRole();
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const form = useForm<RoleFormValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      name: '',
      description: '',
      permissions: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await saveRole.mutateAsync({
      name: values.name,
      description: values.description,
      permissions: values.permissions.split(',').map((entry) => entry.trim()).filter(Boolean),
    });
    form.reset();
  });

  const columns = useMemo<ColumnDef<AdminRole>[]>(
    () => [
      { accessorKey: 'name', header: 'Role Name' },
      { accessorKey: 'description', header: 'Description' },
      {
        accessorKey: 'permissions',
        header: 'Permissions',
        cell: ({ row }) => row.original.permissions.join(', '),
      },
    ],
    [],
  );

  const rows = rolesQuery.data ?? [];
  const start = pagination.pageIndex * pagination.pageSize;
  const pagedRows = rows.slice(start, start + pagination.pageSize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin · Roles"
        description="Manage role definitions and platform permission bundles."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Roles' }]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Create Role</CardTitle>
            <CardDescription>Create a new role with comma-separated permission keys.</CardDescription>
          </div>
          <Button onClick={onSubmit} loading={saveRole.isPending} loadingText="Saving role...">
            Save Role
          </Button>
        </CardHeader>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <Input placeholder="Role name" {...form.register('name')} />
            {form.formState.errors.name ? <p className="mt-1 text-xs text-danger">{form.formState.errors.name.message}</p> : null}
          </div>
          <div>
            <Input placeholder="Description" {...form.register('description')} />
            {form.formState.errors.description ? <p className="mt-1 text-xs text-danger">{form.formState.errors.description.message}</p> : null}
          </div>
          <div className="md:col-span-2">
            <Input placeholder="permission.one, permission.two" {...form.register('permissions')} />
            {form.formState.errors.permissions ? (
              <p className="mt-1 text-xs text-danger">{form.formState.errors.permissions.message}</p>
            ) : null}
          </div>
        </form>
      </Card>

      {rolesQuery.isError ? (
        <ErrorState title="Unable to load roles" description="Please retry." onRetry={() => rolesQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={pagedRows}
          total={rows.length}
          loading={rolesQuery.isLoading || saveRole.isPending}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(rows.length / pagination.pageSize))}
        />
      )}
    </div>
  );
}
