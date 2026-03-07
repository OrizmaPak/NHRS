import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { EncounterSummaryCard } from '@/modules/provider/components/EncounterSummaryCard';
import { PatientSummaryCard } from '@/modules/provider/components/PatientSummaryCard';
import { useEncounter } from '@/api/hooks/useEncounter';
import { useFinalizeEncounter } from '@/api/hooks/useFinalizeEncounter';

export function EncounterDetailsPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const query = useEncounter(id);
  const finalizeEncounter = useFinalizeEncounter();

  const encounter = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Encounter ${id}`}
        description="Detailed encounter review and linked clinical workflows."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Encounters', href: '/app/provider/encounters' }, { label: id }]}
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="encounters.update">
              <Button asChild variant="outline">
                <Link to={`/app/provider/encounters/${id}/edit`}>Edit Encounter</Link>
              </Button>
            </PermissionGate>
            {encounter ? (
              <Button asChild variant="outline">
                <Link to={`/app/provider/patient/${encounter.nin}`}>Open Patient</Link>
              </Button>
            ) : null}
            <PermissionGate permission="encounters.finalize">
              <Button
                onClick={async () => {
                  if (!encounter) return;
                  await finalizeEncounter.mutateAsync({ encounterId: encounter.id, nin: encounter.nin });
                }}
              >
                Finalize
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {query.isLoading ? <LoadingSkeleton className="h-56 w-full" /> : null}
      {query.isError ? (
        <ErrorState title="Unable to load encounter" description="Please retry." onRetry={() => query.refetch()} />
      ) : null}

      {encounter ? (
        <>
          <PatientSummaryCard name={encounter.patientName} nin={encounter.nin} subtitle="Patient context" />
          <EncounterSummaryCard
            encounterId={encounter.encounterId}
            encounterType={encounter.encounterType}
            visitDate={encounter.visitDate}
            clinician={encounter.clinician}
            facility={encounter.provider}
            status={encounter.status}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Diagnosis & Notes</CardTitle>
                  <CardDescription>Clinical summary and attending notes.</CardDescription>
                </div>
              </CardHeader>
              <div className="space-y-3 text-sm">
                <div><p className="text-xs text-muted">Presenting Complaint</p><p className="text-foreground">{encounter.presentingComplaint || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">History Notes</p><p className="text-foreground">{encounter.historyNotes || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Diagnosis</p><p className="text-foreground">{encounter.diagnosis || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Clinician Notes</p><p className="text-foreground">{encounter.clinicianNotes || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Follow-up</p><p className="text-foreground">{encounter.followUpRecommendation || 'N/A'}</p></div>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Vitals & Linked Workflows</CardTitle>
                  <CardDescription>Vitals and related lab/pharmacy links.</CardDescription>
                </div>
              </CardHeader>
              <div className="space-y-3 text-sm">
                <div><p className="text-xs text-muted">Blood Pressure</p><p className="text-foreground">{encounter.vitalSigns.bp || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Temperature</p><p className="text-foreground">{encounter.vitalSigns.temp || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Pulse</p><p className="text-foreground">{encounter.vitalSigns.pulse || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Weight</p><p className="text-foreground">{encounter.vitalSigns.weight || 'N/A'}</p></div>
                <div>
                  <p className="text-xs text-muted">Linked Labs</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {encounter.linkedLabs.length ? encounter.linkedLabs.map((labId) => (
                      <Button key={labId} asChild size="sm" variant="outline">
                        <Link to={`/app/provider/labs/${labId}`}>{labId}</Link>
                      </Button>
                    )) : <p className="text-foreground">No linked labs</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted">Linked Prescriptions</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {encounter.linkedPrescriptions.length ? encounter.linkedPrescriptions.map((prescriptionId) => (
                      <Button key={prescriptionId} asChild size="sm" variant="outline">
                        <Link to={`/app/provider/pharmacy/${prescriptionId}`}>{prescriptionId}</Link>
                      </Button>
                    )) : <p className="text-foreground">No linked prescriptions</p>}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Audit / Metadata</CardTitle>
            </CardHeader>
            <Timeline>
              <TimelineItem title="Encounter Created" timestamp={encounter.visitDate} badge="Create">
                Encounter created by {encounter.clinician}
              </TimelineItem>
              <TimelineItem title="Last Updated" timestamp={encounter.updatedAt} badge="Update">
                Latest update on encounter metadata.
              </TimelineItem>
            </Timeline>
          </Card>
        </>
      ) : null}
    </div>
  );
}
