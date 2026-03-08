import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { FilterBar } from '@/components/data/FilterBar';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ActionBar } from '@/components/data/ActionBar';
import { Drawer } from '@/components/overlays/Drawer';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/feedback/EmptyState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useAddPersonalEntry, useTimeline } from '@/api/hooks/useTimeline';

const addEntrySchema = z.object({
  symptoms: z.string().min(5, 'Enter a short symptom summary'),
  notes: z.string().max(500).optional(),
  occurredAt: z.string().optional(),
});

type AddEntryForm = z.infer<typeof addEntrySchema>;

const recordTypeOptions = ['citizen_symptom', 'encounter', 'lab_result', 'pharmacy_dispense', 'note'];

export function TimelinePage() {
  const [providerFilter, setProviderFilter] = useState('');
  const [recordType, setRecordType] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const timelineQuery = useTimeline({
    provider: providerFilter || undefined,
    type: recordType || undefined,
    from: dateFrom || undefined,
    to: dateTo || undefined,
  });
  const addEntryMutation = useAddPersonalEntry();

  const form = useForm<AddEntryForm>({
    resolver: zodResolver(addEntrySchema),
    defaultValues: { symptoms: '', notes: '', occurredAt: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await addEntryMutation.mutateAsync(values);
    toast.success('Personal health entry added');
    form.reset();
    setDrawerOpen(false);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Health Timeline"
        description="Track your records across encounters, labs, pharmacy, and personal entries."
        breadcrumbs={[{ label: 'Public' }, { label: 'Timeline' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={providerFilter || null}
            onChange={setProviderFilter}
            placeholder="Filter by provider"
            loadOptions={async (search) => {
              const names = Array.from(
                new Set((timelineQuery.data ?? []).map((entry) => entry.providerName).filter(Boolean)),
              );
              return names
                .filter((name) => name.toLowerCase().includes(search.toLowerCase()))
                .map((name) => ({ value: name, label: name }));
            }}
          />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={recordType}
            onChange={setRecordType}
            placeholder="Record type"
            loadOptions={async (search) =>
              recordTypeOptions
                .filter((opt) => opt.includes(search.toLowerCase()))
                .map((opt) => ({ value: opt, label: opt.replace('_', ' ') }))
            }
          />
        </div>
        <div className="grid w-full grid-cols-2 gap-2 md:w-auto">
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="From date" />
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="To date" />
        </div>
        <ActionBar>
          <PermissionGate permission={['records.create', 'records.symptoms.create', 'records.entry.create']}>
            <Button onClick={() => setDrawerOpen(true)}>Add personal health entry</Button>
          </PermissionGate>
        </ActionBar>
      </FilterBar>

      {timelineQuery.isLoading ? (
        <div className="space-y-3">
          <LoadingSkeleton className="h-20 w-full" />
          <LoadingSkeleton className="h-20 w-full" />
          <LoadingSkeleton className="h-20 w-full" />
        </div>
      ) : null}

      {timelineQuery.isError ? (
        <ErrorState
          title="Unable to load timeline"
          description="Please retry. If this persists, contact support."
          onRetry={() => timelineQuery.refetch()}
        />
      ) : null}

      {!timelineQuery.isLoading && !timelineQuery.isError && (timelineQuery.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No timeline entries yet"
          description="Records will appear here when you or a provider adds activity."
          actionLabel="Add personal entry"
          onAction={() => setDrawerOpen(true)}
        />
      ) : null}

      {!timelineQuery.isLoading && !timelineQuery.isError && (timelineQuery.data?.length ?? 0) > 0 ? (
        <Timeline>
          {timelineQuery.data?.map((entry) => (
            <TimelineItem key={entry.id} title={entry.recordType.replace('_', ' ')} timestamp={entry.date} badge={entry.providerName}>
              <div className="space-y-2">
                <p>{entry.description}</p>
                <StatusBadge status={entry.status} />
              </div>
            </TimelineItem>
          ))}
        </Timeline>
      ) : null}

      <Drawer open={isDrawerOpen} onOpenChange={setDrawerOpen} title="Add personal health entry">
        <form className="space-y-4" onSubmit={onSubmit}>
          <FormField label="Symptoms" error={form.formState.errors.symptoms?.message}>
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              {...form.register('symptoms')}
              placeholder="Describe what you are experiencing"
            />
          </FormField>
          <FormField label="Notes" error={form.formState.errors.notes?.message}>
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              {...form.register('notes')}
              placeholder="Optional context"
            />
          </FormField>
          <FormField label="Date observed">
            <Input type="date" {...form.register('occurredAt')} />
          </FormField>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={addEntryMutation.isPending} loadingText="Saving...">
              Save entry
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
