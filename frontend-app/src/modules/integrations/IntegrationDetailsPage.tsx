import { useParams } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useIntegrationDetails } from '@/api/hooks/useIntegrations';

type LogRow = { id: string; level: 'info' | 'warning' | 'error'; message: string; timestamp: string };
type ErrorRow = { id: string; code: string; message: string; timestamp: string };

export function IntegrationDetailsPage() {
  const { id = '' } = useParams();
  const detailsQuery = useIntegrationDetails(id);
  const [logPagination, setLogPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [errorPagination, setErrorPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });

  const logColumns = useMemo<ColumnDef<LogRow>[]>(
    () => [
      { accessorKey: 'level', header: 'Level', cell: ({ row }) => <StatusBadge status={row.original.level} /> },
      { accessorKey: 'message', header: 'Message' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );

  const errorColumns = useMemo<ColumnDef<ErrorRow>[]>(
    () => [
      { accessorKey: 'code', header: 'Error Code' },
      { accessorKey: 'message', header: 'Message' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );

  if (detailsQuery.isError) {
    return <ErrorState title="Unable to load integration details" description="Please retry." onRetry={() => detailsQuery.refetch()} />;
  }

  const details = detailsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={details?.name ?? 'Integration Details'}
        description="Configuration, health, synchronization logs, and error history."
        breadcrumbs={[{ label: 'Integrations', href: '/app/integrations' }, { label: details?.name ?? id }]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Connection Status</CardTitle>
            <CardDescription>Provider {details?.provider ?? 'N/A'} - {details?.authType ?? 'N/A'}</CardDescription>
          </div>
          <StatusBadge status={details?.status ?? 'warning'} />
        </CardHeader>
        <p className="text-sm text-muted">Last sync: {details?.lastSyncAt ?? 'N/A'}</p>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Current integration configuration snapshot.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Object.entries(details?.configuration ?? {}).map(([key, value]) => (
            <div key={key} className="rounded-md border border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{key}</p>
              <p className="text-sm text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sync Logs</CardTitle>
            <CardDescription>Latest synchronization and connectivity logs.</CardDescription>
          </div>
        </CardHeader>
        <DataTable
          columns={logColumns}
          data={details?.logs ?? []}
          total={details?.logs.length ?? 0}
          loading={detailsQuery.isLoading}
          pagination={logPagination}
          onPaginationChange={setLogPagination}
          pageCount={Math.max(1, Math.ceil((details?.logs.length ?? 0) / logPagination.pageSize))}
          searchPlaceholder="Search logs"
        />
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Error History</CardTitle>
            <CardDescription>Historical integration errors for troubleshooting.</CardDescription>
          </div>
        </CardHeader>
        <DataTable
          columns={errorColumns}
          data={details?.errorHistory ?? []}
          total={details?.errorHistory.length ?? 0}
          loading={detailsQuery.isLoading}
          pagination={errorPagination}
          onPaginationChange={setErrorPagination}
          pageCount={Math.max(1, Math.ceil((details?.errorHistory.length ?? 0) / errorPagination.pageSize))}
          searchPlaceholder="Search errors"
        />
      </Card>
    </div>
  );
}
