import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { type BranchRow, useOrganizations, useScopedBranches, useScopedInstitutions } from '@/api/hooks/useInstitutions';

function cap(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function BranchesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });

  const orgId = searchParams.get('orgId') || undefined;
  const institutionId = searchParams.get('institutionId') || undefined;

  const orgsQuery = useOrganizations({ page: 1, limit: 200 });
  const institutionsQuery = useScopedInstitutions({ page: 1, limit: 200, orgId });
  const branchesQuery = useScopedBranches({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    orgId,
    institutionId,
    q: q || undefined,
    status: status || undefined,
  });

  const orgOptions = (orgsQuery.data?.rows ?? []).map((entry) => ({ value: entry.organizationId, label: entry.name }));
  const institutionOptions = (institutionsQuery.data?.rows ?? []).map((entry) => ({
    value: entry.institutionId,
    label: `${entry.name} (${entry.code})`,
  }));

  const columns = useMemo<ColumnDef<BranchRow>[]>(() => [
    { accessorKey: 'name', header: 'Branch' },
    { accessorKey: 'organizationId', header: 'Organization' },
    { accessorKey: 'institutionId', header: 'Institution' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => cap(row.original.type || 'N/A') },
    {
      accessorKey: 'capabilities',
      header: 'Capabilities',
      cell: ({ row }) => row.original.capabilities.length > 0 ? row.original.capabilities.join(', ') : 'N/A',
    },
    { accessorKey: 'state', header: 'State' },
    { accessorKey: 'lga', header: 'LGA' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Link to={`/app/branches/${row.original.branchId}`} className="text-sm font-medium text-primary hover:underline">
          View
        </Link>
      ),
    },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="Standalone branch workspace. Filter by organization or institution scope."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Branches' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search branches" />
        </div>
        <div className="w-full md:max-w-sm">
          <SmartSelect
            value={orgId || null}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value) next.set('orgId', value);
              else next.delete('orgId');
              next.delete('institutionId');
              setSearchParams(next);
            }}
            placeholder="Organization"
            loadOptions={async (input) =>
              orgOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
        </div>
        <div className="w-full md:max-w-sm">
          <SmartSelect
            value={institutionId || null}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value) next.set('institutionId', value);
              else next.delete('institutionId');
              setSearchParams(next);
            }}
            placeholder="Institution"
            loadOptions={async (input) =>
              institutionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={status}
            onChange={setStatus}
            placeholder="Status"
            loadOptions={async (input) =>
              ['active', 'closed', 'suspended']
                .filter((entry) => entry.includes(input.toLowerCase()))
                .map((entry) => ({ value: entry, label: cap(entry) }))
            }
          />
        </div>
      </FilterBar>

      {branchesQuery.isError ? (
        <ErrorState title="Unable to load branches" description="Retry loading branch records." onRetry={() => branchesQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={branchesQuery.data?.rows ?? []}
          total={branchesQuery.data?.total ?? 0}
          loading={branchesQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((branchesQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}
    </div>
  );
}
