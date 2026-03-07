import { PageHeader } from '@/components/layout/PageHeader';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';

const timelineEvents = [
  {
    id: 'evt1',
    title: 'Vaccination record added',
    detail: 'Routine immunization entry synced from St. Catherine Hospital.',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'evt2',
    title: 'Lab result available',
    detail: 'CBC test result published by Royal Diagnostics.',
    timestamp: new Date().toISOString(),
  },
];

export function PublicTimelinePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Health Timeline"
        description="Citizen-friendly longitudinal record view with trusted institutional attribution."
        breadcrumbs={[{ label: 'Public' }, { label: 'Timeline' }]}
      />

      <Timeline>
        {timelineEvents.map((event) => (
          <TimelineItem key={event.id} title={event.title} timestamp={event.timestamp} badge="Timeline">
            {event.detail}
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  );
}
