import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { ClinicalNotesSection } from '@/modules/provider/components/ClinicalNotesSection';
import { VitalsFormSection } from '@/modules/provider/components/VitalsFormSection';
import { PatientSummaryCard } from '@/modules/provider/components/PatientSummaryCard';
import { usePatientProfile } from '@/api/hooks/usePatientProfile';
import { useEncounter } from '@/api/hooks/useEncounter';
import { useCreateEncounter } from '@/api/hooks/useCreateEncounter';
import { useUpdateEncounter } from '@/api/hooks/useUpdateEncounter';
import { useFinalizeEncounter } from '@/api/hooks/useFinalizeEncounter';

const schema = z.object({
  nin: z.string().min(11, 'NIN is required'),
  encounterType: z.string().min(2, 'Encounter type is required'),
  visitDate: z.string().min(1, 'Visit date/time is required'),
  presentingComplaint: z.string().min(3, 'Presenting complaint is required'),
  historyNotes: z.string().optional(),
  diagnosis: z.string().optional(),
  clinicianNotes: z.string().optional(),
  followUpRecommendation: z.string().optional(),
  status: z.string().min(1, 'Status is required'),
  bp: z.string().optional(),
  temp: z.string().optional(),
  pulse: z.string().optional(),
  weight: z.string().optional(),
});

type Values = z.infer<typeof schema>;

export function EncounterFormPage() {
  const navigate = useNavigate();
  const { nin: ninParam, id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id) && searchParams.get('mode') === 'edit';

  const encounterQuery = useEncounter(id ?? '');
  const initialNin = ninParam || encounterQuery.data?.nin || '';
  const patientQuery = usePatientProfile(initialNin);
  const createEncounter = useCreateEncounter();
  const updateEncounter = useUpdateEncounter();
  const finalizeEncounter = useFinalizeEncounter();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      nin: ninParam || '',
      encounterType: 'outpatient',
      visitDate: new Date().toISOString().slice(0, 16),
      presentingComplaint: '',
      historyNotes: '',
      diagnosis: '',
      clinicianNotes: '',
      followUpRecommendation: '',
      status: 'draft',
      bp: '',
      temp: '',
      pulse: '',
      weight: '',
    },
  });

  useEffect(() => {
    if (!encounterQuery.data || !isEdit) return;
    setValue('nin', encounterQuery.data.nin);
    setValue('encounterType', encounterQuery.data.encounterType);
    setValue('visitDate', encounterQuery.data.visitDate.slice(0, 16));
    setValue('presentingComplaint', encounterQuery.data.presentingComplaint);
    setValue('historyNotes', encounterQuery.data.historyNotes);
    setValue('diagnosis', encounterQuery.data.diagnosis);
    setValue('clinicianNotes', encounterQuery.data.clinicianNotes);
    setValue('followUpRecommendation', encounterQuery.data.followUpRecommendation);
    setValue('status', encounterQuery.data.status);
    setValue('bp', encounterQuery.data.vitalSigns.bp || '');
    setValue('temp', encounterQuery.data.vitalSigns.temp || '');
    setValue('pulse', encounterQuery.data.vitalSigns.pulse || '');
    setValue('weight', encounterQuery.data.vitalSigns.weight || '');
  }, [encounterQuery.data, isEdit, setValue]);

  const vitals = {
    bp: watch('bp') || '',
    temp: watch('temp') || '',
    pulse: watch('pulse') || '',
    weight: watch('weight') || '',
  };

  const title = isEdit ? 'Edit Encounter' : 'New Encounter';

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title={title}
        description="Capture encounter details with structured clinical workflow sections."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Encounters', href: '/app/provider/encounters' }, { label: title }]}
      />

      {initialNin && patientQuery.data ? (
        <PatientSummaryCard
          name={patientQuery.data.name}
          nin={patientQuery.data.nin}
          age={patientQuery.data.age ?? undefined}
          gender={patientQuery.data.gender}
          subtitle="Selected patient for encounter entry"
        />
      ) : null}

      {encounterQuery.isError ? (
        <ErrorState title="Unable to load encounter" description="Please retry." onRetry={() => encounterQuery.refetch()} />
      ) : null}
      {isEdit && encounterQuery.isLoading ? <LoadingSkeleton className="h-60 w-full" /> : null}

      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          const payload = {
            nin: values.nin,
            encounterType: values.encounterType,
            visitDate: values.visitDate,
            presentingComplaint: values.presentingComplaint,
            historyNotes: values.historyNotes || '',
            diagnosis: values.diagnosis || '',
            clinicianNotes: values.clinicianNotes || '',
            followUpRecommendation: values.followUpRecommendation || '',
            status: values.status,
            vitalSigns: {
              bp: values.bp || '',
              temp: values.temp || '',
              pulse: values.pulse || '',
              weight: values.weight || '',
            },
          };

          if (isEdit && id) {
            await updateEncounter.mutateAsync({ ...payload, encounterId: id });
            toast.success('Encounter updated');
            navigate(`/app/provider/encounters/${id}`);
            return;
          }

          await createEncounter.mutateAsync(payload);
          toast.success('Encounter created');
          navigate(`/app/provider/encounters?nin=${values.nin}`);
        })}
      >
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Encounter Basics</CardTitle>
              <CardDescription>Patient context and encounter classification.</CardDescription>
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Patient NIN</label>
              <Input {...register('nin')} />
              {errors.nin ? <p className="text-xs text-danger">{errors.nin.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Encounter Type</label>
              <Input {...register('encounterType')} placeholder="outpatient" />
              {errors.encounterType ? <p className="text-xs text-danger">{errors.encounterType.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Visit Date/Time</label>
              <Input type="datetime-local" {...register('visitDate')} />
              {errors.visitDate ? <p className="text-xs text-danger">{errors.visitDate.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Status</label>
              <Input {...register('status')} placeholder="draft" />
              {errors.status ? <p className="text-xs text-danger">{errors.status.message}</p> : null}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Clinical Notes</CardTitle>
              <CardDescription>Capture complaint, history, diagnosis, notes, and follow-up.</CardDescription>
            </div>
          </CardHeader>
          <ClinicalNotesSection
            presentingComplaint={watch('presentingComplaint') || ''}
            onPresentingComplaintChange={(value) => setValue('presentingComplaint', value, { shouldValidate: true })}
            historyNotes={watch('historyNotes') || ''}
            onHistoryNotesChange={(value) => setValue('historyNotes', value)}
            diagnosis={watch('diagnosis') || ''}
            onDiagnosisChange={(value) => setValue('diagnosis', value)}
            clinicianNotes={watch('clinicianNotes') || ''}
            onClinicianNotesChange={(value) => setValue('clinicianNotes', value)}
            followUpRecommendation={watch('followUpRecommendation') || ''}
            onFollowUpRecommendationChange={(value) => setValue('followUpRecommendation', value)}
            errors={{
              presentingComplaint: errors.presentingComplaint?.message,
              historyNotes: errors.historyNotes?.message,
              diagnosis: errors.diagnosis?.message,
              clinicianNotes: errors.clinicianNotes?.message,
              followUpRecommendation: errors.followUpRecommendation?.message,
            }}
          />
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Vital Signs</CardTitle>
              <CardDescription>Record clinical baseline values.</CardDescription>
            </div>
          </CardHeader>
          <VitalsFormSection
            values={vitals}
            onChange={(next) => {
              setValue('bp', next.bp || '');
              setValue('temp', next.temp || '');
              setValue('pulse', next.pulse || '');
              setValue('weight', next.weight || '');
            }}
          />
        </Card>

        <div className="sticky bottom-0 z-10 rounded-lg border border-border bg-surface/95 p-3 backdrop-blur">
          <ActionBar>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Draft'}
            </Button>
            <PermissionGate permission="encounters.finalize">
              <Button
                type="button"
                onClick={handleSubmit(async (values) => {
                  const payload = {
                    nin: values.nin,
                    encounterType: values.encounterType,
                    visitDate: values.visitDate,
                    presentingComplaint: values.presentingComplaint,
                    historyNotes: values.historyNotes || '',
                    diagnosis: values.diagnosis || '',
                    clinicianNotes: values.clinicianNotes || '',
                    followUpRecommendation: values.followUpRecommendation || '',
                    status: 'finalized',
                    vitalSigns: {
                      bp: values.bp || '',
                      temp: values.temp || '',
                      pulse: values.pulse || '',
                      weight: values.weight || '',
                    },
                  };

                  if (isEdit && id) {
                    await updateEncounter.mutateAsync({ ...payload, encounterId: id });
                    await finalizeEncounter.mutateAsync({ encounterId: id, nin: values.nin });
                    toast.success('Encounter finalized');
                    navigate(`/app/provider/encounters/${id}`);
                    return;
                  }

                  await createEncounter.mutateAsync(payload);
                  toast.success('Encounter finalized');
                  navigate(`/app/provider/encounters?nin=${values.nin}`);
                })}
              >
                Finalize Encounter
              </Button>
            </PermissionGate>
          </ActionBar>
        </div>
      </form>
    </div>
  );
}
