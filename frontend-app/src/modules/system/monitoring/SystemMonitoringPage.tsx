import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useSystemMonitoring } from '@/api/hooks/useSystemMonitoring';

type ErrorRow = { id: string; service: string; error: string; timestamp: string };
type FailedRow = { id: string; endpoint: string; status: number; count: number; timestamp: string };
type SlowRow = { id: string; endpoint: string; latencyMs: number; timestamp: string };

export function SystemMonitoringPage() {
  const query = useSystemMonitoring();
  const [errorPagination, setErrorPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [failedPagination, setFailedPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [slowPagination, setSlowPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });

  const errorColumns = useMemo<ColumnDef<ErrorRow>[]>(
    () => [
      { accessorKey: 'service', header: 'Service' },
      { accessorKey: 'error', header: 'Error' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );
  const failedColumns = useMemo<ColumnDef<FailedRow>[]>(
    () => [
      { accessorKey: 'endpoint', header: 'Endpoint' },
      { accessorKey: 'status', header: 'HTTP Status' },
      { accessorKey: 'count', header: 'Fail Count' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );
  const slowColumns = useMemo<ColumnDef<SlowRow>[]>(
    () => [
      { accessorKey: 'endpoint', header: 'Endpoint' },
      { accessorKey: 'latencyMs', header: 'Latency (ms)' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Monitoring"
        description="Operational monitoring for API health, database, queue, and background jobs."
        breadcrumbs={[{ label: 'System' }, { label: 'Monitoring' }]}
      />

      {query.isError ? <ErrorState title="Unable to load monitoring data" description="Please retry." onRetry={() => query.refetch()} /> : null}

      <KpiGrid>
        <StatCard label="API Health" value={query.data?.apiHealth ?? 'unknown'} delta="Gateway and service endpoints" trend="up" />
        <StatCard label="Database" value={query.data?.databaseStatus ?? 'unknown'} delta="Mongo/Atlas connectivity" trend="up" />
        <StatCard label="Message Queue" value={query.data?.queueStatus ?? 'unknown'} delta="Async pipelines" trend="up" />
        <StatCard label="Background Jobs" value={query.data?.backgroundJobs ?? 'unknown'} delta="Worker execution" trend="up" />
      </KpiGrid>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Subsystem Status</CardTitle>
            <CardDescription>Current health indicators for critical platform components.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['API', query.data?.apiHealth ?? 'warning'],
            ['Database', query.data?.databaseStatus ?? 'warning'],
            ['Queue', query.data?.queueStatus ?? 'warning'],
            ['Jobs', query.data?.backgroundJobs ?? 'warning'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
              <div className="mt-2">
                <StatusBadge status={value} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent System Errors</CardTitle>
              <CardDescription>Latest service exceptions and failures.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={errorColumns}
            data={query.data?.recentErrors ?? []}
            total={query.data?.recentErrors.length ?? 0}
            loading={query.isLoading}
            pagination={errorPagination}
            onPaginationChange={setErrorPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.recentErrors.length ?? 0) / errorPagination.pageSize))}
          />
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Failed API Calls</CardTitle>
              <CardDescription>Recurring failed calls by endpoint and status.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={failedColumns}
            data={query.data?.failedCalls ?? []}
            total={query.data?.failedCalls.length ?? 0}
            loading={query.isLoading}
            pagination={failedPagination}
            onPaginationChange={setFailedPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.failedCalls.length ?? 0) / failedPagination.pageSize))}
          />
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Slow Requests</CardTitle>
            <CardDescription>Top high-latency requests across modules.</CardDescription>
          </div>
        </CardHeader>
        <DataTable
          columns={slowColumns}
          data={query.data?.slowRequests ?? []}
          total={query.data?.slowRequests.length ?? 0}
          loading={query.isLoading}
          pagination={slowPagination}
          onPaginationChange={setSlowPagination}
          pageCount={Math.max(1, Math.ceil((query.data?.slowRequests.length ?? 0) / slowPagination.pageSize))}
        />
      </Card>
    </div>
  );
}
