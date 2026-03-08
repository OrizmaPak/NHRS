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
import {
  MedicationFormSection,
  type MedicationFormValues,
} from '@/modules/provider/components/MedicationFormSection';
import { usePatientProfile } from '@/api/hooks/usePatientProfile';
import { useEncounters } from '@/api/hooks/useEncounters';
import { useCreatePrescription } from '@/api/hooks/useCreatePrescription';

const schema = z.object({
  nin: z.string().min(11, 'NIN is required'),
  linkedEncounterId: z.string().optional(),
  medicationName: z.string().min(2, 'Medication name is required'),
  dosage: z.string().min(1, 'Dosage is required'),
  route: z.string().min(1, 'Route is required'),
  frequency: z.string().min(1, 'Frequency is required'),
  duration: z.string().min(1, 'Duration is required'),
  quantity: z.string().min(1, 'Quantity is required'),
  instructions: z.string().max(1000).optional(),
  prescribingProvider: z.string().optional(),
  prescribedDate: z.string().min(1, 'Prescribed date is required'),
});

type Values = z.infer<typeof schema>;

const administrationRoutes = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'other'];

export function PrescriptionFormPage() {
  const navigate = useNavigate();
  const { nin: ninParam } = useParams();
  const [linkedEncounterId, setLinkedEncounterId] = useState<string | null>(null);
  const createPrescription = useCreatePrescription();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      nin: ninParam || '',
      linkedEncounterId: '',
      medicationName: '',
      dosage: '',
      route: 'oral',
      frequency: '',
      duration: '',
      quantity: '',
      instructions: '',
      prescribingProvider: '',
      prescribedDate: new Date().toISOString().slice(0, 16),
    },
  });

  const nin = watch('nin');
  const patientQuery = usePatientProfile(nin);
  const encountersQuery = useEncounters(nin, { page: 1, limit: 50 });
  const encounterOptions = useMemo(() => encountersQuery.data?.rows ?? [], [encountersQuery.data?.rows]);

  const medicationValues: MedicationFormValues = {
    medicationName: watch('medicationName') || '',
    dosage: watch('dosage') || '',
    route: watch('route') || '',
    frequency: watch('frequency') || '',
    duration: watch('duration') || '',
    quantity: watch('quantity') || '',
    instructions: watch('instructions') || '',
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title="New Prescription"
        description="Create medication orders and prepare dispensing workflow."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Pharmacy', href: '/app/provider/pharmacy' }, { label: 'New Prescription' }]}
      />

      {nin && patientQuery.data ? (
        <PatientSummaryCard
          name={patientQuery.data.name}
          nin={patientQuery.data.nin}
          age={patientQuery.data.age ?? undefined}
          gender={patientQuery.data.gender}
          subtitle="Selected patient for prescription"
        />
      ) : null}

      {patientQuery.isError ? (
        <ErrorState title="Unable to load patient" description="Confirm NIN and retry." onRetry={() => patientQuery.refetch()} />
      ) : null}

      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          await createPrescription.mutateAsync({
            nin: values.nin,
            linkedEncounterId: linkedEncounterId || values.linkedEncounterId || undefined,
            medicationName: values.medicationName,
            dosage: values.dosage,
            route: values.route,
            frequency: values.frequency,
            duration: values.duration,
            quantity: values.quantity,
            instructions: values.instructions,
            prescribingProvider: values.prescribingProvider,
            prescribedDate: values.prescribedDate,
          });
          toast.success('Prescription created');
          navigate(`/app/provider/pharmacy?nin=${values.nin}`);
        })}
      >
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Prescription Basics</CardTitle>
              <CardDescription>Capture patient and provider context before medication details.</CardDescription>
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Patient NIN</label>
              <Input {...register('nin')} />
              {errors.nin ? <p className="text-xs text-danger">{errors.nin.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Prescribing Provider</label>
              <Input {...register('prescribingProvider')} placeholder="Provider user or name" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Route</label>
              <select
                {...register('route')}
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                {administrationRoutes.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
              {errors.route ? <p className="text-xs text-danger">{errors.route.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Prescribed Date</label>
              <Input type="datetime-local" {...register('prescribedDate')} />
              {errors.prescribedDate ? <p className="text-xs text-danger">{errors.prescribedDate.message}</p> : null}
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-1">
              <label className="text-sm font-medium text-foreground">Linked Encounter (optional)</label>
              <LinkedEncounterSelect value={linkedEncounterId} onChange={setLinkedEncounterId} encounters={encounterOptions} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Medication Details</CardTitle>
              <CardDescription>Define dosage, route, schedule, and instruction details.</CardDescription>
            </div>
          </CardHeader>
          <MedicationFormSection
            showRoute={false}
            values={medicationValues}
            onChange={(next) => {
              setValue('medicationName', next.medicationName, { shouldValidate: true });
              setValue('dosage', next.dosage, { shouldValidate: true });
              setValue('frequency', next.frequency, { shouldValidate: true });
              setValue('duration', next.duration, { shouldValidate: true });
              setValue('quantity', next.quantity, { shouldValidate: true });
              setValue('instructions', next.instructions);
            }}
          />
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {errors.medicationName ? <p className="text-xs text-danger">{errors.medicationName.message}</p> : <span />}
            {errors.dosage ? <p className="text-xs text-danger">{errors.dosage.message}</p> : <span />}
            {errors.quantity ? <p className="text-xs text-danger">{errors.quantity.message}</p> : <span />}
          </div>
        </Card>

        <div className="sticky bottom-0 z-10 rounded-lg border border-border bg-surface/95 p-3 backdrop-blur">
          <ActionBar>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting || createPrescription.isPending}
              loadingText="Saving..."
            >
              Create Prescription
            </Button>
          </ActionBar>
        </div>
      </form>
    </div>
  );
}
