import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useAdminUsers, useSuspendUser, type AdminUser } from '@/api/hooks/useAdminUsers';

export function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const usersQuery = useAdminUsers({ page: pagination.pageIndex + 1, limit: pagination.pageSize, q: query || undefined });
  const suspendUser = useSuspendUser();

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      { accessorKey: 'name', header: 'Name' },
      { accessorKey: 'email', header: 'Email' },
      { accessorKey: 'role', header: 'Role' },
      { accessorKey: 'institution', header: 'Institution' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline">View</Button>
            <Button size="sm" variant="outline">Edit</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await suspendUser.mutateAsync(row.original.id);
              }}
            >
              Suspend
            </Button>
          </div>
        ),
      },
    ],
    [suspendUser],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin · Users"
        description="Manage platform users, role assignment, and account status."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Users' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search users by name or email" />
        </div>
      </FilterBar>

      {usersQuery.isError ? (
        <ErrorState title="Unable to load users" description="Please retry." onRetry={() => usersQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={usersQuery.data?.rows ?? []}
          total={usersQuery.data?.total ?? 0}
          loading={usersQuery.isLoading || suspendUser.isPending}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((usersQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}
    </div>
  );
}
