import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useDevTools } from '@/api/hooks/useDevTools';

type RequestRow = { id: string; method: string; path: string; status: number; durationMs: number; timestamp: string };
type IntegrationCallRow = { id: string; integration: string; result: string; timestamp: string };
type EndpointRow = { id: string; name: string; path: string; health: 'healthy' | 'warning' | 'critical' };

export function DevToolsPage() {
  const query = useDevTools();
  const [reqPagination, setReqPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [callPagination, setCallPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [endpointPagination, setEndpointPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const requestColumns = useMemo<ColumnDef<RequestRow>[]>(
    () => [
      { accessorKey: 'method', header: 'Method' },
      { accessorKey: 'path', header: 'Path' },
      { accessorKey: 'status', header: 'Status' },
      { accessorKey: 'durationMs', header: 'Duration (ms)' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );
  const integrationColumns = useMemo<ColumnDef<IntegrationCallRow>[]>(
    () => [
      { accessorKey: 'integration', header: 'Integration' },
      { accessorKey: 'result', header: 'Result' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );
  const endpointColumns = useMemo<ColumnDef<EndpointRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Endpoint' },
      { accessorKey: 'path', header: 'Path' },
      { accessorKey: 'health', header: 'Health', cell: ({ row }) => <StatusBadge status={row.original.health} /> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer Utilities"
        description="Diagnostics for API request traces, integration calls, and endpoint checks."
        breadcrumbs={[{ label: 'System' }, { label: 'Dev Tools' }]}
      />

      {query.isError ? <ErrorState title="Unable to load dev tools data" description="Please retry." onRetry={() => query.refetch()} /> : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Test Endpoints</CardTitle>
            <CardDescription>Lightweight endpoint checks for operational diagnostics.</CardDescription>
          </div>
        </CardHeader>
        <DataTable
          columns={endpointColumns}
          data={query.data?.testEndpoints ?? []}
          total={query.data?.testEndpoints.length ?? 0}
          loading={query.isLoading}
          pagination={endpointPagination}
          onPaginationChange={setEndpointPagination}
          pageCount={Math.max(1, Math.ceil((query.data?.testEndpoints.length ?? 0) / endpointPagination.pageSize))}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent API Request Logs</CardTitle>
              <CardDescription>Recent request traces and status diagnostics.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={requestColumns}
            data={query.data?.requestLogs ?? []}
            total={query.data?.requestLogs.length ?? 0}
            loading={query.isLoading}
            pagination={reqPagination}
            onPaginationChange={setReqPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.requestLogs.length ?? 0) / reqPagination.pageSize))}
          />
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent Integration Calls</CardTitle>
              <CardDescription>Latest integration invocation outcomes.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={integrationColumns}
            data={query.data?.integrationCalls ?? []}
            total={query.data?.integrationCalls.length ?? 0}
            loading={query.isLoading}
            pagination={callPagination}
            onPaginationChange={setCallPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.integrationCalls.length ?? 0) / callPagination.pageSize))}
          />
        </Card>
      </div>
    </div>
  );
}
