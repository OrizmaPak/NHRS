import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ActionBar } from '@/components/data/ActionBar';
import { ErrorState } from '@/components/feedback/ErrorState';
import { PatientSummaryCard } from '@/modules/provider/components/PatientSummaryCard';
import { LinkedEncounterSelect } from '@/modules/provider/components/LinkedEncounterSelect';
import { SpecimenSection } from '@/modules/provider/components/SpecimenSection';
import { usePatientProfile } from '@/api/hooks/usePatientProfile';
import { useEncounters } from '@/api/hooks/useEncounters';
import { useCreateLabRequest } from '@/api/hooks/useCreateLabRequest';

const schema = z.object({
  nin: z.string().min(11, 'NIN is required'),
  linkedEncounterId: z.string().optional(),
  testCategory: z.string().min(2, 'Test category is required'),
  testType: z.string().min(2, 'Test type is required'),
  urgency: z.string().min(2, 'Urgency is required'),
  notes: z.string().max(1000).optional(),
  requestedDate: z.string().min(1, 'Requested date is required'),
  specimenInfo: z.string().optional(),
});

type Values = z.infer<typeof schema>;

const testCategories = ['hematology', 'chemistry', 'microbiology', 'immunology', 'radiology', 'other'];
const urgencyLevels = ['routine', 'urgent', 'stat'];

export function LabRequestFormPage() {
  const navigate = useNavigate();
  const { nin: ninParam } = useParams();
  const [linkedEncounterId, setLinkedEncounterId] = useState<string | null>(null);
  const createLabRequest = useCreateLabRequest();

  const {
    register,
    watch,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      nin: ninParam || '',
      linkedEncounterId: '',
      testCategory: 'hematology',
      testType: '',
      urgency: 'routine',
      notes: '',
      requestedDate: new Date().toISOString().slice(0, 16),
      specimenInfo: '',
    },
  });

  const nin = watch('nin');
  const patientQuery = usePatientProfile(nin);
  const encountersQuery = useEncounters(nin, { page: 1, limit: 50 });
  const encounterOptions = useMemo(() => encountersQuery.data?.rows ?? [], [encountersQuery.data?.rows]);

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title="New Lab Request"
        description="Request lab work, link encounter context, and prepare result workflow."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Labs', href: '/app/provider/labs' }, { label: 'New Request' }]}
      />

      {nin && patientQuery.data ? (
        <PatientSummaryCard
          name={patientQuery.data.name}
          nin={patientQuery.data.nin}
          age={patientQuery.data.age ?? undefined}
          gender={patientQuery.data.gender}
          subtitle="Selected patient for lab request"
        />
      ) : null}

      {patientQuery.isError ? (
        <ErrorState title="Unable to load patient" description="Confirm NIN and retry." onRetry={() => patientQuery.refetch()} />
      ) : null}

      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          await createLabRequest.mutateAsync({
            nin: values.nin,
            linkedEncounterId: linkedEncounterId || values.linkedEncounterId || undefined,
            testCategory: values.testCategory,
            testType: values.testType,
            urgency: values.urgency,
            notes: values.notes,
            requestedDate: values.requestedDate,
            specimenInfo: values.specimenInfo,
          });
          toast.success('Lab request created');
          navigate(`/app/provider/labs?nin=${values.nin}`);
        })}
      >
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Request Details</CardTitle>
              <CardDescription>Capture patient, test category/type, urgency, and timing.</CardDescription>
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Patient NIN</label>
              <Input {...register('nin')} />
              {errors.nin ? <p className="text-xs text-danger">{errors.nin.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Test Category</label>
              <select
                {...register('testCategory')}
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                {testCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              {errors.testCategory ? <p className="text-xs text-danger">{errors.testCategory.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Test Type</label>
              <Input {...register('testType')} placeholder="Full Blood Count" />
              {errors.testType ? <p className="text-xs text-danger">{errors.testType.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Urgency</label>
              <select
                {...register('urgency')}
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                {urgencyLevels.map((urgency) => (
                  <option key={urgency} value={urgency}>
                    {urgency}
                  </option>
                ))}
              </select>
              {errors.urgency ? <p className="text-xs text-danger">{errors.urgency.message}</p> : null}
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-1">
              <label className="text-sm font-medium text-foreground">Requested Date</label>
              <Input type="datetime-local" {...register('requestedDate')} />
              {errors.requestedDate ? <p className="text-xs text-danger">{errors.requestedDate.message}</p> : null}
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-3">
              <label className="text-sm font-medium text-foreground">Linked Encounter (optional)</label>
              <LinkedEncounterSelect value={linkedEncounterId} onChange={setLinkedEncounterId} encounters={encounterOptions} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Clinical Context</CardTitle>
              <CardDescription>Add specimen and indication details for accurate processing.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            <SpecimenSection
              specimenInfo={watch('specimenInfo') || ''}
              onSpecimenInfoChange={(value) => setValue('specimenInfo', value)}
            />
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Clinical Indication / Notes</label>
              <textarea
                {...register('notes')}
                className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                placeholder="Reason for request and clinical context"
              />
              {errors.notes ? <p className="text-xs text-danger">{errors.notes.message}</p> : null}
            </div>
          </div>
        </Card>

        <div className="sticky bottom-0 z-10 rounded-lg border border-border bg-surface/95 p-3 backdrop-blur">
          <ActionBar>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting || createLabRequest.isPending}
              loadingText="Submitting..."
            >
              Create Lab Request
            </Button>
          </ActionBar>
        </div>
      </form>
    </div>
  );
}
