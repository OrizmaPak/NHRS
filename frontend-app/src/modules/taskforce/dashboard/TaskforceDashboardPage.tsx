import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, FileClock, FilePlus2, ListChecks, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { ActionBar } from '@/components/data/ActionBar';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useTaskforceDashboard } from '@/api/hooks/useTaskforceDashboard';
import { useAuditEvents } from '@/api/hooks/useAuditEvents';
import { useContextStore } from '@/stores/contextStore';
import { deriveTaskforceScope } from '@/modules/taskforce/utils/scope';

export function TaskforceDashboardPage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const scope = deriveTaskforceScope(activeContext);
  const dashboardQuery = useTaskforceDashboard({ scopeLevel: scope.level, state: scope.state, lga: scope.lga });
  const auditQuery = useAuditEvents({ page: 1, limit: 5, state: scope.state });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Taskforce Command Center"
        description={`Oversight and enforcement operations for ${scope.label} scope.`}
        breadcrumbs={[{ label: 'Taskforce' }, { label: 'Dashboard' }]}
        actions={
          <ActionBar>
            <PermissionGate permission="governance.case.read">
              <Button asChild variant="outline">
                <Link to="/app/taskforce/complaints">
                  <ListChecks className="h-4 w-4" />
                  Open Complaints
                </Link>
              </Button>
            </PermissionGate>
            <PermissionGate permission="governance.case.read">
              <Button asChild variant="outline">
                <Link to="/app/taskforce/cases">
                  <FileClock className="h-4 w-4" />
                  Open Cases
                </Link>
              </Button>
            </PermissionGate>
            <PermissionGate permission={['audit.read', 'governance.case.read']}>
              <Button asChild>
                <Link to="/app/governance/oversight">
                  <ArrowUpRight className="h-4 w-4" />
                  Oversight View
                </Link>
              </Button>
            </PermissionGate>
          </ActionBar>
        }
      />

      {dashboardQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <LoadingSkeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : dashboardQuery.isError ? (
        <ErrorState
          title="Unable to load taskforce metrics"
          description="Please retry shortly."
          onRetry={() => dashboardQuery.refetch()}
        />
      ) : (
        <KpiGrid>
          <StatCard label="Active Complaints" value={String(dashboardQuery.data?.activeComplaints ?? 0)} delta="Current workload" />
          <StatCard label="Open Cases" value={String(dashboardQuery.data?.openCases ?? 0)} delta="Under active investigation" />
          <StatCard
            label="Escalated Cases"
            value={String(dashboardQuery.data?.escalatedCases ?? 0)}
            delta="Higher-level review"
            trend={(dashboardQuery.data?.escalatedCases ?? 0) > 0 ? 'down' : 'up'}
          />
          <StatCard
            label="Overdue Complaints"
            value={String(dashboardQuery.data?.overdueComplaints ?? 0)}
            delta="Requires immediate action"
            trend="down"
          />
          <StatCard
            label="Institutions Under Review"
            value={String(dashboardQuery.data?.institutionsUnderReview ?? 0)}
            delta="Active compliance watch"
          />
          <StatCard label="Recent Audit Events" value={String(dashboardQuery.data?.recentAuditEvents ?? 0)} delta="Latest governance activity" />
        </KpiGrid>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Operational Actions</CardTitle>
              <CardDescription>Fast-track core enforcement workflows.</CardDescription>
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PermissionGate permission="governance.case.update_status">
              <Button asChild variant="outline" className="justify-start">
                <Link to="/app/taskforce/complaints">
                  <ShieldCheck className="h-4 w-4" />
                  Assign Complaints
                </Link>
              </Button>
            </PermissionGate>
            <PermissionGate permission="governance.case.create">
              <Button asChild variant="outline" className="justify-start">
                <Link to="/app/taskforce/complaints">
                  <FilePlus2 className="h-4 w-4" />
                  Create Case From Complaint
                </Link>
              </Button>
            </PermissionGate>
            <PermissionGate permission="governance.case.escalate">
              <Button asChild variant="outline" className="justify-start">
                <Link to="/app/taskforce/cases">
                  <ArrowUpRight className="h-4 w-4" />
                  Escalate Case
                </Link>
              </Button>
            </PermissionGate>
            <PermissionGate permission="audit.read">
              <Button asChild variant="outline" className="justify-start">
                <Link to="/app/governance/audit">
                  <AlertTriangle className="h-4 w-4" />
                  Open Audit Trail
                </Link>
              </Button>
            </PermissionGate>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent Audit</CardTitle>
              <CardDescription>Latest activities in your jurisdiction.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            {auditQuery.isLoading ? (
              <>
                <LoadingSkeleton className="h-16 w-full" />
                <LoadingSkeleton className="h-16 w-full" />
              </>
            ) : null}
            {(auditQuery.data?.rows ?? []).slice(0, 4).map((row) => (
              <div key={row.id} className="rounded-md border border-border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{row.action}</p>
                  <StatusBadge status="info" />
                </div>
                <p className="text-xs text-muted">{row.actor} • {row.module}</p>
                <p className="text-xs text-muted">{new Date(row.timestamp).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
