import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useSystemHealthOverview } from '@/api/hooks/useSystemHealthOverview';

export function SystemHealthPage() {
  const query = useSystemHealthOverview();

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health Overview"
        description="Platform uptime, active incidents, resolved incidents, and outage timeline."
        breadcrumbs={[{ label: 'System' }, { label: 'Health' }]}
      />

      {query.isError ? <ErrorState title="Unable to load system health" description="Please retry." onRetry={() => query.refetch()} /> : null}

      <KpiGrid>
        <StatCard label="Uptime" value={`${query.data?.uptimePercentage ?? 0}%`} trend="up" delta="Rolling 30 days" />
        <StatCard label="Active Incidents" value={String(query.data?.activeIncidents ?? 0)} trend={(query.data?.activeIncidents ?? 0) > 0 ? 'up' : 'down'} delta="Open now" />
        <StatCard label="Resolved Incidents" value={String(query.data?.resolvedIncidents ?? 0)} trend="up" delta="Resolved in period" />
        <StatCard label="Recent Outages" value={String(query.data?.recentOutages ?? 0)} trend={(query.data?.recentOutages ?? 0) > 0 ? 'up' : 'down'} delta="Reported outages" />
      </KpiGrid>

      <Timeline>
        {(query.data?.incidents ?? []).map((incident) => (
          <TimelineItem
            key={incident.id}
            title={incident.title}
            timestamp={incident.startedAt}
            badge={incident.status}
          >
            <div className="flex items-center gap-2">
              <StatusBadge status={incident.severity} />
              <span>{incident.status === 'resolved' ? `Resolved: ${incident.resolvedAt ?? 'N/A'}` : 'Currently active'}</span>
            </div>
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  );
}
