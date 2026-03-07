import * as Tabs from '@radix-ui/react-tabs';
import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';

export function PatientDetailsPage() {
  const { patientId } = useParams();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Details"
        description={`Profile, timeline, and record module pointers for patient ${patientId}`}
        breadcrumbs={[{ label: 'Provider' }, { label: 'Patient Search' }, { label: 'Details' }]}
      />

      <Tabs.Root defaultValue="overview" className="space-y-4">
        <Tabs.List className="inline-flex rounded-md border border-border bg-surface p-1">
          <Tabs.Trigger value="overview" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger value="timeline" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Timeline
          </Tabs.Trigger>
          <Tabs.Trigger value="audit" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Audit
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview">
          <Card>
            <p className="text-sm text-muted">Demographic summary, onboarding status, and role-linked profile metadata render here.</p>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="timeline">
          <Timeline>
            <TimelineItem title="Encounter entry" badge="Encounter" timestamp={new Date().toISOString()}>
              Added by St. Catherine Teaching Hospital.
            </TimelineItem>
            <TimelineItem title="Lab result" badge="Laboratory" timestamp={new Date().toISOString()}>
              Complete blood count record linked.
            </TimelineItem>
          </Timeline>
        </Tabs.Content>

        <Tabs.Content value="audit">
          <Card>
            <p className="text-sm text-muted">Read/write history with actor attribution and request trace IDs appears here.</p>
          </Card>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
