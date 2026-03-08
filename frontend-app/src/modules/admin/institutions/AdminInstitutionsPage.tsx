import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useInstitutions, type InstitutionRow } from '@/api/hooks/useInstitutions';

export function AdminInstitutionsPage() {
  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });

  const institutionsQuery = useInstitutions({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: query || undefined,
  });

  const columns = useMemo<ColumnDef<InstitutionRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Institution' },
      { accessorKey: 'type', header: 'Type' },
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'lga', header: 'LGA' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: () => (
          <div className="flex gap-2">
            <Button size="sm" variant="outline">View</Button>
            <Button size="sm" variant="outline">Edit</Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin · Institutions"
        description="Manage institution metadata, operational status, and profile details."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Institutions' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search institutions" />
        </div>
      </FilterBar>

      {institutionsQuery.isError ? (
        <ErrorState title="Unable to load institutions" description="Please retry." onRetry={() => institutionsQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={institutionsQuery.data?.rows ?? []}
          total={institutionsQuery.data?.total ?? 0}
          loading={institutionsQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((institutionsQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}
    </div>
  );
}
