import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SmartSelect } from '@/components/data/SmartSelect';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAlerts } from '@/api/hooks/useAlerts';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';

const severities = ['info', 'warning', 'critical'];
const scopes = ['national', 'state', 'lga'];
const types = ['outbreak', 'compliance', 'enforcement', 'system'];

export function AlertsPage() {
  const [severity, setSeverity] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);

  const alertsQuery = useAlerts({
    severity: severity || undefined,
    scope: scope || undefined,
    type: type || undefined,
  });

  const alerts = alertsQuery.data ?? [];
  const criticalCount = alerts.filter((alert) => alert.severity === 'critical').length;
  const warningCount = alerts.filter((alert) => alert.severity === 'warning').length;
  const infoCount = alerts.filter((alert) => alert.severity === 'info').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Alerts"
        description="National, state, and local alerts for enforcement and operational readiness."
        breadcrumbs={[{ label: 'System' }, { label: 'Alerts' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-[180px]">
          <SmartSelect
            value={severity}
            onChange={setSeverity}
            placeholder="Severity"
            loadOptions={async (input) =>
              severities.filter((entry) => entry.includes(input.toLowerCase())).map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[180px]">
          <SmartSelect
            value={scope}
            onChange={setScope}
            placeholder="Scope"
            loadOptions={async (input) =>
              scopes.filter((entry) => entry.includes(input.toLowerCase())).map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[220px]">
          <SmartSelect
            value={type}
            onChange={setType}
            placeholder="Type"
            loadOptions={async (input) =>
              types.filter((entry) => entry.includes(input.toLowerCase())).map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
      </FilterBar>

      {alertsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LoadingSkeleton className="h-40 w-full" />
          <LoadingSkeleton className="h-40 w-full" />
        </div>
      ) : null}

      {alertsQuery.isError ? (
        <ErrorState title="Unable to load alerts" description="Please retry." onRetry={() => alertsQuery.refetch()} />
      ) : null}

      {!alertsQuery.isLoading && !alertsQuery.isError && (alertsQuery.data?.length ?? 0) === 0 ? (
        <EmptyState title="No active alerts" description="No alerts match current filters." />
      ) : null}

      {!alertsQuery.isLoading && !alertsQuery.isError && (alertsQuery.data?.length ?? 0) > 0 ? (
        <>
          <KpiGrid>
            <StatCard label="Critical Alerts" value={String(criticalCount)} delta="Requires immediate action" trend={criticalCount > 0 ? 'up' : 'down'} />
            <StatCard label="Warning Alerts" value={String(warningCount)} delta="Watchlist" trend={warningCount > 0 ? 'up' : 'down'} />
            <StatCard label="Info Alerts" value={String(infoCount)} delta="Advisory updates" trend="down" />
          </KpiGrid>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {alertsQuery.data?.map((alert) => (
              <Card key={alert.id}>
                <CardHeader>
                  <div>
                    <CardTitle>{alert.title}</CardTitle>
                    <CardDescription>
                      {alert.type} - {new Date(alert.createdAt).toLocaleString()}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={alert.severity} />
                    <span className="rounded-md border border-border px-2 py-1 text-xs text-muted">{alert.scope}</span>
                  </div>
                </CardHeader>
                <p className="text-sm text-foreground">{alert.description || 'No additional alert description.'}</p>
                <div className="mt-3 text-xs text-muted">
                  Affected institutions: {alert.affectedInstitutions.length ? alert.affectedInstitutions.join(', ') : 'N/A'}
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

