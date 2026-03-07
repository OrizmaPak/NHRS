import { Link } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, Building2, FileWarning, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useOversightSummary } from '@/api/hooks/useOversightSummary';
import { useCases } from '@/api/hooks/useCases';

export function OversightPage() {
  const summaryQuery = useOversightSummary();
  const casesQuery = useCases({ page: 1, limit: 5, severity: 'high', status: 'open' });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance Oversight"
        description="Executive oversight of unresolved risk, escalations, and flagged institutions."
        breadcrumbs={[{ label: 'Governance' }, { label: 'Oversight' }]}
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Priority Risks</CardTitle>
              <CardDescription>Unresolved high-priority complaints and overdue investigations.</CardDescription>
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

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent Escalation Queue</CardTitle>
              <CardDescription>Quick drilldown for case escalation operations.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            {(casesQuery.data?.rows ?? []).map((row) => (
              <div key={row.id} className="rounded-md border border-border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{row.caseId}</p>
                  <span className="text-xs text-muted">{row.state}</span>
                </div>
                <p className="text-sm text-muted">{row.institution}</p>
                <div className="mt-2 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-warning" />
                  <p className="text-xs text-muted">{row.stage} • {row.status}</p>
                </div>
              </div>
            ))}
            <Button asChild variant="outline" className="w-full">
              <Link to="/app/taskforce/cases">
                <ArrowUpRight className="h-4 w-4" />
                Drill into Case Management
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
