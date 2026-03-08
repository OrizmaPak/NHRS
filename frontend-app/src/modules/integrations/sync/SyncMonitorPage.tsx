import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ActionBar } from '@/components/data/ActionBar';
import { Button } from '@/components/ui/Button';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useSyncEvents } from '@/api/hooks/useSyncEvents';

const systems = ['EMR', 'LIS', 'NIN', 'Pharmacy', 'GovRegistry'];
const modules = ['records-index', 'labs-module', 'pharmacy-module', 'profile-service', 'audit-service'];

export function SyncMonitorPage() {
  const [systemFilter, setSystemFilter] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const syncQuery = useSyncEvents({
    system: systemFilter || undefined,
    module: moduleFilter || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const events = useMemo(
    () => [...(syncQuery.data ?? [])].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [syncQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Synchronization Monitor"
        description="Track inter-system synchronization events, failures, latency, and destination flow."
        breadcrumbs={[{ label: 'Integrations', href: '/app/integrations' }, { label: 'Sync Monitor' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-[200px]">
          <SmartSelect
            value={systemFilter}
            onChange={setSystemFilter}
            placeholder="Source System"
            loadOptions={async (input) =>
              systems.filter((entry) => entry.toLowerCase().includes(input.toLowerCase())).map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[220px]">
          <SmartSelect
            value={moduleFilter}
            onChange={setModuleFilter}
            placeholder="Destination Module"
            loadOptions={async (input) =>
              modules.filter((entry) => entry.toLowerCase().includes(input.toLowerCase())).map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <ActionBar>
          <Button
            variant="outline"
            onClick={() => {
              setSystemFilter(null);
              setModuleFilter(null);
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </Button>
        </ActionBar>
      </FilterBar>

      {syncQuery.isError ? (
        <ErrorState title="Unable to load sync events" description="Please retry." onRetry={() => syncQuery.refetch()} />
      ) : null}

      {!syncQuery.isLoading && !syncQuery.isError && events.length === 0 ? (
        <EmptyState title="No synchronization events" description="No events match current filters." />
      ) : null}

      <Timeline>
        {events.map((event) => (
          <TimelineItem
            key={event.id}
            title={`${event.source} -> ${event.destination}`}
            timestamp={event.timestamp}
            badge={`${event.latencyMs}ms`}
          >
            <div className="flex items-center gap-2">
              <StatusBadge status={event.status} />
              <span>{event.message}</span>
            </div>
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  );
}
