import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useDisableIntegration, useIntegrations, useTestIntegration, type IntegrationRow } from '@/api/hooks/useIntegrations';

export function IntegrationsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const integrationsQuery = useIntegrations();
  const testMutation = useTestIntegration();
  const disableMutation = useDisableIntegration();

  const rows = useMemo(() => {
    const list = integrationsQuery.data ?? [];
    if (!query.trim()) return list;
    const key = query.toLowerCase();
    return list.filter((entry) => `${entry.name} ${entry.provider} ${entry.authType}`.toLowerCase().includes(key));
  }, [integrationsQuery.data, query]);

  const start = pagination.pageIndex * pagination.pageSize;
  const pagedRows = rows.slice(start, start + pagination.pageSize);

  const columns = useMemo<ColumnDef<IntegrationRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Integration' },
      { accessorKey: 'provider', header: 'Provider' },
      { accessorKey: 'authType', header: 'Auth Type' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      { accessorKey: 'lastSyncAt', header: 'Last Sync' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/integrations/${row.original.id}`)}>
              View
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await testMutation.mutateAsync(row.original.id);
                toast.success(`Connection test sent for ${row.original.name}`);
              }}
            >
              Test
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await disableMutation.mutateAsync(row.original.id);
                toast.success(`${row.original.name} disabled`);
              }}
            >
              Disable
            </Button>
          </div>
        ),
      },
    ],
    [disableMutation, navigate, testMutation],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integration Management"
        description="Manage EMR, laboratory, identity, and third-party system integrations."
        breadcrumbs={[{ label: 'Integrations' }]}
        actions={
          <Button variant="outline" onClick={() => navigate('/app/integrations/api-keys')}>
            API Keys
          </Button>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search integrations" />
        </div>
        <Button variant="outline" onClick={() => setQuery('')}>Clear</Button>
      </FilterBar>

      {integrationsQuery.isError ? (
        <ErrorState title="Unable to load integrations" description="Please retry." onRetry={() => integrationsQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={pagedRows}
          total={rows.length}
          loading={integrationsQuery.isLoading || testMutation.isPending || disableMutation.isPending}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(rows.length / pagination.pageSize))}
          searchPlaceholder="Search integration rows"
        />
      )}
    </div>
  );
}
