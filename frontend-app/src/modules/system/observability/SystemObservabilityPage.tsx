import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useSystemHealth, type SystemHealth } from '@/api/hooks/useSystemHealth';

type ServiceRow = SystemHealth['services'][number];
type ErrorRow = SystemHealth['errors'][number];
type SlowQueryRow = SystemHealth['slowQueries'][number];

export function SystemObservabilityPage() {
  const healthQuery = useSystemHealth();
  const [servicePagination, setServicePagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [errorPagination, setErrorPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [slowPagination, setSlowPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });

  const serviceColumns = useMemo<ColumnDef<ServiceRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Service' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'latencyMs',
        header: 'Latency (ms)',
        cell: ({ row }) => row.original.latencyMs ?? 'N/A',
      },
    ],
    [],
  );

  const errorColumns = useMemo<ColumnDef<ErrorRow>[]>(
    () => [
      { accessorKey: 'service', header: 'Service' },
      { accessorKey: 'message', header: 'Error' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );

  const slowColumns = useMemo<ColumnDef<SlowQueryRow>[]>(
    () => [
      { accessorKey: 'service', header: 'Service' },
      { accessorKey: 'operation', header: 'Operation' },
      { accessorKey: 'durationMs', header: 'Duration (ms)' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );

  const serviceStats = {
    healthy: (healthQuery.data?.services ?? []).filter((entry) => entry.status === 'healthy').length,
    degraded: (healthQuery.data?.services ?? []).filter((entry) => entry.status === 'degraded').length,
    down: (healthQuery.data?.services ?? []).filter((entry) => entry.status === 'down').length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Observability"
        description="Service health, incident visibility, and slow query monitoring."
        breadcrumbs={[{ label: 'System' }, { label: 'Observability' }]}
      />

      {healthQuery.isError ? (
        <ErrorState title="Unable to load observability data" description="Please retry." onRetry={() => healthQuery.refetch()} />
      ) : null}

      <KpiGrid>
        <StatCard label="Healthy Services" value={String(serviceStats.healthy)} trend="up" delta="Nominal" />
        <StatCard label="Degraded Services" value={String(serviceStats.degraded)} trend={serviceStats.degraded > 0 ? 'up' : 'down'} delta="Requires attention" />
        <StatCard label="Down Services" value={String(serviceStats.down)} trend={serviceStats.down > 0 ? 'up' : 'down'} delta="Incident state" />
        <StatCard label="Recent Errors" value={String(healthQuery.data?.errors.length ?? 0)} trend={(healthQuery.data?.errors.length ?? 0) > 0 ? 'up' : 'down'} delta="Latest window" />
      </KpiGrid>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>API / Service Health</CardTitle>
            <CardDescription>Current status and latency by service.</CardDescription>
          </div>
        </CardHeader>
        <DataTable
          columns={serviceColumns}
          data={healthQuery.data?.services ?? []}
          total={healthQuery.data?.services.length ?? 0}
          loading={healthQuery.isLoading}
          pagination={servicePagination}
          onPaginationChange={setServicePagination}
          pageCount={Math.max(1, Math.ceil((healthQuery.data?.services.length ?? 0) / servicePagination.pageSize))}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent System Errors</CardTitle>
              <CardDescription>Latest application and integration failures.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={errorColumns}
            data={healthQuery.data?.errors ?? []}
            total={healthQuery.data?.errors.length ?? 0}
            loading={healthQuery.isLoading}
            pagination={errorPagination}
            onPaginationChange={setErrorPagination}
            pageCount={Math.max(1, Math.ceil((healthQuery.data?.errors.length ?? 0) / errorPagination.pageSize))}
          />
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent Slow Queries</CardTitle>
              <CardDescription>Potential performance bottlenecks.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={slowColumns}
            data={healthQuery.data?.slowQueries ?? []}
            total={healthQuery.data?.slowQueries.length ?? 0}
            loading={healthQuery.isLoading}
            pagination={slowPagination}
            onPaginationChange={setSlowPagination}
            pageCount={Math.max(1, Math.ceil((healthQuery.data?.slowQueries.length ?? 0) / slowPagination.pageSize))}
          />
        </Card>
      </div>
    </div>
  );
}
