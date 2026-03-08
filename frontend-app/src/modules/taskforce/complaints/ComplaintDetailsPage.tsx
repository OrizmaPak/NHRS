import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { AuditTrailList } from '@/components/data/AuditTrailList';
import { Button } from '@/components/ui/Button';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { AssignmentDrawer } from '@/modules/taskforce/components/AssignmentDrawer';
import { EscalateComplaintDrawer } from '@/modules/taskforce/components/EscalateComplaintDrawer';
import { useComplaint } from '@/api/hooks/useComplaint';
import { useAssignComplaint } from '@/api/hooks/useAssignComplaint';
import { useEscalateComplaint } from '@/api/hooks/useEscalateComplaint';

const officers = [
  { value: 'officer-1', label: 'Ayo Bello', description: 'State reviewer' },
  { value: 'officer-2', label: 'Ngozi Adamu', description: 'LGA compliance officer' },
  { value: 'officer-3', label: 'Ifeanyi Ude', description: 'National escalation desk' },
];

export function ComplaintDetailsPage() {
  const { id = '' } = useParams();
  const complaintQuery = useComplaint(id);
  const assignComplaint = useAssignComplaint();
  const escalateComplaint = useEscalateComplaint();

  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);

  const complaint = complaintQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Complaint ${id}`}
        description="Detailed triage, actions, and linked case context."
        breadcrumbs={[{ label: 'Taskforce' }, { label: 'Complaints', href: '/app/taskforce/complaints' }, { label: id }]}
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="governance.case.update_status">
              <Button variant="outline" onClick={() => setAssignmentOpen(true)}>
                Assign
              </Button>
            </PermissionGate>
            <PermissionGate permission="governance.case.escalate">
              <Button variant="outline" onClick={() => setEscalateOpen(true)}>
                Escalate
              </Button>
            </PermissionGate>
            {complaint?.linkedCaseId ? (
              <Button asChild>
                <Link to={`/app/taskforce/cases/${complaint.linkedCaseId}`}>Open linked case</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {complaintQuery.isLoading ? <LoadingSkeleton className="h-48 w-full" /> : null}
      {complaintQuery.isError ? (
        <ErrorState title="Unable to load complaint details" description="Please retry shortly." onRetry={() => complaintQuery.refetch()} />
      ) : null}

      {complaint ? (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Complaint Summary</CardTitle>
                <CardDescription>{complaint.summary}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={complaint.status} />
                <StatusBadge status={complaint.priority} />
              </div>
            </CardHeader>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Reporter</p>
                <p className="font-medium text-foreground">{complaint.anonymous ? 'Anonymous' : complaint.complainant}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Institution</p>
                <p className="font-medium text-foreground">{complaint.institution}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Provider</p>
                <p className="font-medium text-foreground">{complaint.provider}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Jurisdiction</p>
                <p className="font-medium text-foreground">{complaint.lga}, {complaint.state}</p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Workflow Timeline</CardTitle>
                  <CardDescription>Chronological status updates and workflow actions.</CardDescription>
                </div>
              </CardHeader>
              <Timeline>
                {complaint.timeline.length ? complaint.timeline.map((item) => (
                  <TimelineItem key={item.id} title={item.title} badge={item.badge} timestamp={item.timestamp}>
                    {item.detail}
                  </TimelineItem>
                )) : (
                  <TimelineItem title="Complaint logged" badge="Created" timestamp={complaint.createdAt}>
                    Complaint created and awaiting triage.
                  </TimelineItem>
                )}
              </Timeline>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Notes & Attachments</CardTitle>
                  <CardDescription>Internal operational notes and evidence placeholders.</CardDescription>
                </div>
              </CardHeader>
              <div className="space-y-3">
                {complaint.notes.map((note) => (
                  <div key={note.id} className="rounded-md border border-border p-3">
                    <p className="text-sm text-foreground">{note.message}</p>
                    <p className="text-xs text-muted">{note.author} • {new Date(note.createdAt).toLocaleString()}</p>
                  </div>
                ))}
                {!complaint.notes.length ? <p className="text-sm text-muted">No notes captured yet.</p> : null}
                <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted">
                  Attachment support placeholder. File upload integration can be added here.
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Audit Trail</CardTitle>
                <CardDescription>Governance activity around this complaint.</CardDescription>
              </div>
            </CardHeader>
            <AuditTrailList />
          </Card>
        </>
      ) : null}

      <AssignmentDrawer
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        targetLabel="Complaint"
        officers={officers}
        onSubmit={async (values) => {
          if (!complaint) return;
          await assignComplaint.mutateAsync({
            complaintId: complaint.id,
            assigneeId: values.assigneeId,
            dueDate: values.dueDate,
            priority: values.priority,
            comment: values.comment,
          });
        }}
      />

      <EscalateComplaintDrawer
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        onSubmit={async (values) => {
          if (!complaint) return;
          await escalateComplaint.mutateAsync({
            complaintId: complaint.id,
            targetLevel: values.targetLevel,
            targetUnit: values.targetUnit,
            reason: values.reason,
            priority: values.priority,
            notes: values.notes,
          });
        }}
      />
    </div>
  );
}
