import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ActionBar } from '@/components/data/ActionBar';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { useSystemActivityFeed } from '@/api/hooks/useSystemActivityFeed';

const modules = ['complaints', 'cases', 'records', 'labs', 'pharmacy', 'emergency', 'audit'];

export function SystemActivityPage() {
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [actor, setActor] = useState('');
  const [institution, setInstitution] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const activityQuery = useSystemActivityFeed({
    module: moduleFilter || undefined,
    actor: actor || undefined,
    institution: institution || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const items = useMemo(
    () => [...(activityQuery.data ?? [])].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [activityQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Activity Feed"
        description="Global operational activity across clinical, governance, and emergency modules."
        breadcrumbs={[{ label: 'System' }, { label: 'Activity' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-[220px]">
          <SmartSelect
            value={moduleFilter}
            onChange={setModuleFilter}
            placeholder="Module"
            loadOptions={async (input) =>
              modules.filter((entry) => entry.includes(input.toLowerCase())).map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[200px]">
          <Input value={actor} onChange={(event) => setActor(event.target.value)} placeholder="Actor" />
        </div>
        <div className="w-full md:max-w-[220px]">
          <Input value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder="Institution" />
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
              setModuleFilter(null);
              setActor('');
              setInstitution('');
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </Button>
        </ActionBar>
      </FilterBar>

      {activityQuery.isLoading ? (
        <div className="space-y-3">
          <LoadingSkeleton className="h-20 w-full" />
          <LoadingSkeleton className="h-20 w-full" />
          <LoadingSkeleton className="h-20 w-full" />
        </div>
      ) : null}

      {activityQuery.isError ? (
        <ErrorState title="Unable to load activity feed" description="Please retry." onRetry={() => activityQuery.refetch()} />
      ) : null}

      {!activityQuery.isLoading && !activityQuery.isError && items.length === 0 ? (
        <EmptyState title="No activity" description="No events match the current filters." />
      ) : null}

      {!activityQuery.isLoading && !activityQuery.isError && items.length > 0 ? (
        <Timeline>
          {items.map((item) => (
            <TimelineItem
              key={item.id}
              title={`${item.actor} • ${item.action}`}
              timestamp={item.timestamp}
              badge={item.module}
            >
              {item.target} • {item.institution}
            </TimelineItem>
          ))}
        </Timeline>
      ) : null}
    </div>
  );
}

