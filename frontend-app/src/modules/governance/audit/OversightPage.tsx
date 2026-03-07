import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { AlertCircle, ArrowUpRight, Building2, FileWarning, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ActionBar } from '@/components/data/ActionBar';
import { DataTable } from '@/components/data/DataTable';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { useOversightSummary } from '@/api/hooks/useOversightSummary';
import { useCases } from '@/api/hooks/useCases';
import { useAuditEvents, type AuditEventsParams } from '@/api/hooks/useAuditEvents';
import type { AuditEventRow } from '@/api/hooks/taskforceTypes';

export function OversightPage() {
  const summaryQuery = useOversightSummary();
  const riskCasesQuery = useCases({ page: 1, limit: 8, severity: 'high', status: 'open' });
  const [auditPagination, setAuditPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 6 });

  const auditParams: AuditEventsParams = {
    module: 'cases',
    page: auditPagination.pageIndex + 1,
    limit: auditPagination.pageSize,
  };
  const auditQuery = useAuditEvents(auditParams);

  const auditColumns = useMemo<ColumnDef<AuditEventRow>[]>(
    () => [
      { accessorKey: 'eventId', header: 'Event ID' },
      { accessorKey: 'action', header: 'Action' },
      { accessorKey: 'actor', header: 'Actor' },
      { accessorKey: 'institution', header: 'Institution' },
      {
        accessorKey: 'state',
        header: 'State',
        cell: ({ row }) => <StatusBadge status={row.original.state} />,
      },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance Oversight"
        description="Executive oversight of unresolved risk, escalations, and flagged institutions."
        breadcrumbs={[{ label: 'Governance' }, { label: 'Oversight' }]}
        actions={
          <ActionBar>
            <Button asChild variant="outline">
              <Link to="/app/governance/audit">Open Full Audit</Link>
            </Button>
            <Button asChild>
              <Link to="/app/taskforce/cases">
                <ArrowUpRight className="h-4 w-4" />
                Open Case Queue
              </Link>
            </Button>
          </ActionBar>
        }
      />

      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <LoadingSkeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : summaryQuery.isError ? (
        <ErrorState title="Unable to load oversight summary" description="Please retry shortly." onRetry={() => summaryQuery.refetch()} />
      ) : (
        <KpiGrid>
          <StatCard label="Institutions Flagged" value={String(summaryQuery.data?.institutionsFlagged ?? 0)} delta="Across monitored scope" />
          <StatCard
            label="Unresolved High Priority Complaints"
            value={String(summaryQuery.data?.unresolvedHighPriorityComplaints ?? 0)}
            delta="Requires immediate attention"
            trend="down"
          />
          <StatCard label="Overdue Cases" value={String(summaryQuery.data?.overdueCases ?? 0)} delta="Past SLA threshold" trend="down" />
          <StatCard label="Recent Escalations" value={String(summaryQuery.data?.recentEscalations ?? 0)} delta="Last operational window" />
        </KpiGrid>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Priority Risk Queue</CardTitle>
              <CardDescription>High-severity unresolved cases needing immediate governance action.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            {(riskCasesQuery.data?.rows ?? []).map((row) => (
              <div key={row.id} className="rounded-md border border-border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{row.caseId}</p>
                  <StatusBadge status={row.severity} />
                </div>
                <p className="text-sm text-muted">{row.institution}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <ShieldAlert className="h-4 w-4 text-warning" />
                  <span>{row.stage} • {row.status} • {row.state}</span>
                </div>
              </div>
            ))}
            {!riskCasesQuery.data?.rows?.length ? (
              <p className="text-sm text-muted">No high-severity cases currently in queue.</p>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Operational Signals</CardTitle>
              <CardDescription>What needs attention now.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <AlertCircle className="h-4 w-4 text-danger" />
              <p className="text-sm text-foreground">High-priority complaints awaiting assignment escalation.</p>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <FileWarning className="h-4 w-4 text-warning" />
              <p className="text-sm text-foreground">Case closures delayed due to pending approval workflow.</p>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <Building2 className="h-4 w-4 text-primary" />
              <p className="text-sm text-foreground">Institution review queue has increased this cycle.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent Governance Audit Events</CardTitle>
            <CardDescription>Top recent events tied to case/governance operations.</CardDescription>
          </div>
        </CardHeader>
        {auditQuery.isError ? (
          <ErrorState title="Unable to load oversight audit feed" description="Please retry shortly." onRetry={() => auditQuery.refetch()} />
        ) : (
          <DataTable
            columns={auditColumns}
            data={auditQuery.data?.rows ?? []}
            total={auditQuery.data?.total ?? 0}
            loading={auditQuery.isLoading}
            pagination={auditPagination}
            onPaginationChange={setAuditPagination}
            pageCount={Math.max(1, Math.ceil((auditQuery.data?.total ?? 0) / auditPagination.pageSize))}
          />
        )}
      </Card>
    </div>
  );
}
