import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { PatientSummaryCard } from '@/modules/provider/components/PatientSummaryCard';
import { PrescriptionSummaryCard } from '@/modules/provider/components/PrescriptionSummaryCard';
import {
  MedicationFormSection,
  type MedicationFormValues,
} from '@/modules/provider/components/MedicationFormSection';
import { DispenseDrawer } from '@/modules/provider/components/DispenseDrawer';
import { usePharmacyRecord } from '@/api/hooks/usePharmacyRecord';
import { useUpdatePrescription } from '@/api/hooks/useUpdatePrescription';
import { useDispensePrescription } from '@/api/hooks/useDispensePrescription';

export function PharmacyDetailsPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const query = usePharmacyRecord(id);
  const updatePrescription = useUpdatePrescription();
  const dispensePrescription = useDispensePrescription();
  const [openDispense, setOpenDispense] = useState(false);

  const record = query.data;
  const [formValues, setFormValues] = useState<MedicationFormValues>({
    medicationName: '',
    dosage: '',
    route: '',
    frequency: '',
    duration: '',
    quantity: '',
    instructions: '',
  });

  useEffect(() => {
    if (!record) return;
    setFormValues({
      medicationName: record.medicationName,
      dosage: record.dosage,
      route: record.route,
      frequency: record.frequency,
      duration: record.duration,
      quantity: record.quantity,
      instructions: record.instructions,
    });
  }, [record]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Prescription ${id}`}
        description="Review medication details, update prescription, and record dispense actions."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Pharmacy', href: '/app/provider/pharmacy' }, { label: id }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {record ? (
              <Button asChild variant="outline">
                <Link to={`/app/provider/patient/${record.nin}`}>Open Patient</Link>
              </Button>
            ) : null}
            <PermissionGate permission="pharmacy.update">
              <Button variant="outline" onClick={() => navigate(`/app/provider/pharmacy/${id}/edit`)}>
                Edit Prescription
              </Button>
            </PermissionGate>
            <PermissionGate permission="pharmacy.dispense">
              <Button onClick={() => setOpenDispense(true)}>Dispense</Button>
            </PermissionGate>
          </div>
        }
      />

      {query.isLoading ? <LoadingSkeleton className="h-56 w-full" /> : null}
      {query.isError ? (
        <ErrorState title="Unable to load prescription" description="Please retry." onRetry={() => query.refetch()} />
      ) : null}

      {record ? (
        <>
          <PatientSummaryCard name={record.patientName} nin={record.nin} subtitle="Patient context" />
          <PrescriptionSummaryCard
            prescriptionId={record.prescriptionId}
            medicationName={record.medicationName}
            dosage={record.dosage}
            frequency={record.frequency}
            facility={record.facility}
            status={record.dispenseStatus}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Medication Details</CardTitle>
                  <CardDescription>Prescription data and update workflow.</CardDescription>
                </div>
              </CardHeader>
              <MedicationFormSection values={formValues} onChange={setFormValues} />
              <div className="mt-4 flex flex-wrap gap-2">
                <PermissionGate permission="pharmacy.update">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await updatePrescription.mutateAsync({
                        prescriptionId: record.id,
                        nin: record.nin,
                        linkedEncounterId: record.linkedEncounterId,
                        medicationName: formValues.medicationName,
                        dosage: formValues.dosage,
                        route: formValues.route,
                        frequency: formValues.frequency,
                        duration: formValues.duration,
                        quantity: formValues.quantity,
                        instructions: formValues.instructions,
                        prescribingProvider: record.prescriber,
                        prescribedDate: record.prescribedDate,
                      });
                      toast.success('Prescription updated');
                    }}
                  >
                    Save Prescription Changes
                  </Button>
                </PermissionGate>
                <PermissionGate permission="pharmacy.dispense">
                  <Button onClick={() => setOpenDispense(true)}>Open Dispense Workflow</Button>
                </PermissionGate>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Dispense Details</CardTitle>
                  <CardDescription>Dispense status, completion metadata, and notes.</CardDescription>
                </div>
              </CardHeader>
              <div className="space-y-3 text-sm">
                <div><p className="text-xs text-muted">Status</p><p className="text-foreground">{record.dispenseStatus}</p></div>
                <div><p className="text-xs text-muted">Dispensed Quantity</p><p className="text-foreground">{record.quantityDispensed || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Dispensed By</p><p className="text-foreground">{record.dispensedBy || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Dispensed Date</p><p className="text-foreground">{record.dispensedDate ? new Date(record.dispensedDate).toLocaleString() : 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Dispense Notes</p><p className="text-foreground">{record.dispenseNotes || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Linked Encounter</p><p className="text-foreground">{record.linkedEncounterId || 'Not linked'}</p></div>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <Timeline>
              <TimelineItem title="Prescription Created" timestamp={record.prescribedDate} badge="Create">
                Prescription authored by {record.prescriber}
              </TimelineItem>
              <TimelineItem title="Dispense Update" timestamp={record.dispensedDate ?? record.prescribedDate} badge="Dispense">
                Current status: {record.dispenseStatus}
              </TimelineItem>
            </Timeline>
          </Card>

          <DispenseDrawer
            open={openDispense}
            onOpenChange={setOpenDispense}
            onSubmit={async (values) => {
              await dispensePrescription.mutateAsync({
                prescriptionId: record.id,
                nin: record.nin,
                quantityDispensed: values.quantityDispensed,
                dispensedBy: values.dispensedBy,
                dispensedDate: values.dispensedDate,
                notes: values.notes,
                status: values.status,
              });
            }}
          />
        </>
      ) : null}

      {!record && !query.isLoading && !query.isError ? (
        <ErrorState title="Prescription not found" description="Check the prescription ID and retry." />
      ) : null}

    </div>
  );
}
