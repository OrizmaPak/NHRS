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
import { LabSummaryCard } from '@/modules/provider/components/LabSummaryCard';
import { ResultEntrySection } from '@/modules/provider/components/ResultEntrySection';
import { useLab } from '@/api/hooks/useLab';
import { useUpdateLabResult } from '@/api/hooks/useUpdateLabResult';
import { useCompleteLab } from '@/api/hooks/useCompleteLab';

export function LabDetailsPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const query = useLab(id);
  const updateResult = useUpdateLabResult();
  const completeLab = useCompleteLab();

  const lab = query.data;
  const [resultValues, setResultValues] = useState({
    resultSummary: '',
    observations: '',
    interpretation: '',
    completedDate: new Date().toISOString().slice(0, 16),
    status: 'in_progress',
  });

  useEffect(() => {
    if (!lab) return;
    setResultValues({
      resultSummary: lab.resultSummary || '',
      observations: lab.observations || '',
      interpretation: lab.interpretation || '',
      completedDate: (lab.completedDate ?? new Date().toISOString()).slice(0, 16),
      status: lab.status || 'in_progress',
    });
  }, [lab]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Lab Request ${id}`}
        description="Review request details, enter results, and complete lab workflow."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Labs', href: '/app/provider/labs' }, { label: id }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {lab ? (
              <Button asChild variant="outline">
                <Link to={`/app/provider/patient/${lab.nin}`}>Open Patient</Link>
              </Button>
            ) : null}
            <PermissionGate permission="labs.update">
              <Button variant="outline" onClick={() => navigate(`/app/provider/labs/${id}?mode=edit`)}>
                Edit Result
              </Button>
            </PermissionGate>
            <PermissionGate permission="labs.complete">
              <Button
                onClick={async () => {
                  if (!lab) return;
                  await completeLab.mutateAsync({ labId: lab.id, nin: lab.nin });
                  toast.success('Lab marked completed');
                }}
              >
                Mark Completed
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {query.isLoading ? <LoadingSkeleton className="h-56 w-full" /> : null}
      {query.isError ? (
        <ErrorState title="Unable to load lab request" description="Please retry." onRetry={() => query.refetch()} />
      ) : null}

      {lab ? (
        <>
          <PatientSummaryCard name={lab.patientName} nin={lab.nin} subtitle="Patient context" />
          <LabSummaryCard
            labRequestId={lab.labRequestId}
            testType={lab.testType}
            urgency={lab.urgency}
            facility={lab.facility}
            provider={lab.provider}
            status={lab.status}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Request Origin</CardTitle>
                  <CardDescription>Clinical and specimen details from request stage.</CardDescription>
                </div>
              </CardHeader>
              <div className="space-y-3 text-sm">
                <div><p className="text-xs text-muted">Category</p><p className="text-foreground">{lab.testCategory}</p></div>
                <div><p className="text-xs text-muted">Requested Date</p><p className="text-foreground">{new Date(lab.requestedDate).toLocaleString()}</p></div>
                <div><p className="text-xs text-muted">Linked Encounter</p><p className="text-foreground">{lab.linkedEncounterId ?? 'Not linked'}</p></div>
                <div><p className="text-xs text-muted">Specimen</p><p className="text-foreground">{lab.specimenInfo || 'N/A'}</p></div>
                <div><p className="text-xs text-muted">Clinical Notes</p><p className="text-foreground">{lab.notes || 'N/A'}</p></div>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Result Entry</CardTitle>
                  <CardDescription>Update result fields and submit completion.</CardDescription>
                </div>
              </CardHeader>
              <ResultEntrySection values={resultValues} onChange={setResultValues} />
              <div className="mt-4 flex flex-wrap gap-2">
                <PermissionGate permission="labs.update">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await updateResult.mutateAsync({
                        labId: lab.id,
                        nin: lab.nin,
                        resultSummary: resultValues.resultSummary,
                        observations: resultValues.observations,
                        interpretation: resultValues.interpretation,
                        completedDate: resultValues.completedDate,
                        status: resultValues.status,
                      });
                      toast.success('Lab result updated');
                    }}
                  >
                    Save Result Update
                  </Button>
                </PermissionGate>
                <PermissionGate permission="labs.complete">
                  <Button
                    onClick={async () => {
                      await updateResult.mutateAsync({
                        labId: lab.id,
                        nin: lab.nin,
                        resultSummary: resultValues.resultSummary,
                        observations: resultValues.observations,
                        interpretation: resultValues.interpretation,
                        completedDate: resultValues.completedDate,
                        status: 'completed',
                      });
                      await completeLab.mutateAsync({ labId: lab.id, nin: lab.nin });
                      toast.success('Lab completed');
                    }}
                  >
                    Final Submit Result
                  </Button>
                </PermissionGate>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Timeline / History</CardTitle>
            </CardHeader>
            <Timeline>
              <TimelineItem title="Lab Requested" timestamp={lab.requestedDate} badge="Request">
                Requested by {lab.provider} at {lab.facility}
              </TimelineItem>
              <TimelineItem title="Result Updated" timestamp={lab.completedDate ?? lab.requestedDate} badge="Update">
                Result status: {lab.status}
              </TimelineItem>
            </Timeline>
          </Card>
        </>
      ) : null}

      {!lab && !query.isLoading && !query.isError ? (
        <ErrorState title="Lab request not found" description="Check the request ID and retry." />
      ) : null}

    </div>
  );
}
