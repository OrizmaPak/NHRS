import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Link, useParams } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { DataTable } from '@/components/data/DataTable';
import { AuditTrailList } from '@/components/data/AuditTrailList';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { AssignmentDrawer } from '@/modules/taskforce/components/AssignmentDrawer';
import { EscalateCaseDrawer } from '@/modules/taskforce/components/EscalateCaseDrawer';
import { useCase } from '@/api/hooks/useCase';
import { useCaseNotes } from '@/api/hooks/useCaseNotes';
import { useAddCaseNote } from '@/api/hooks/useAddCaseNote';
import { useAssignCase } from '@/api/hooks/useAssignCase';
import { useEscalateCase } from '@/api/hooks/useEscalateCase';

const noteSchema = z.object({
  message: z.string().min(5, 'Note should be descriptive').max(1000, 'Note is too long'),
});

const officers = [
  { value: 'officer-1', label: 'Ayo Bello', description: 'State reviewer' },
  { value: 'officer-2', label: 'Ngozi Adamu', description: 'LGA compliance officer' },
  { value: 'officer-3', label: 'Ifeanyi Ude', description: 'National escalation desk' },
];

type NoteValues = z.infer<typeof noteSchema>;

export function CaseDetailsPage() {
  const { id = '' } = useParams();
  const caseQuery = useCase(id);
  const notesQuery = useCaseNotes(id);
  const addCaseNote = useAddCaseNote();
  const assignCase = useAssignCase();
  const escalateCase = useEscalateCase();
  const [relatedPagination, setRelatedPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NoteValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: { message: '' },
  });

  const relatedComplaintColumns = useMemo<ColumnDef<{ id: string; complaintId: string; status: string; priority: string; createdAt: string }>[]>(
    () => [
      { accessorKey: 'complaintId', header: 'Complaint ID' },
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: 'priority', header: 'Priority', cell: ({ row }) => <StatusBadge status={row.original.priority} /> },
      { accessorKey: 'createdAt', header: 'Created' },
      {
        id: 'open',
        header: 'Action',
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm">
            <Link to={`/app/taskforce/complaints/${row.original.id}`}>View</Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const caseItem = caseQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Case ${id}`}
        description="Investigation workflow, escalations, notes, and audit visibility."
        breadcrumbs={[{ label: 'Taskforce' }, { label: 'Cases', href: '/app/taskforce/cases' }, { label: id }]}
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="governance.case.update_status">
              <Button variant="outline" onClick={() => setAssignmentOpen(true)}>Assign</Button>
            </PermissionGate>
            <PermissionGate permission="governance.case.escalate">
              <Button variant="outline" onClick={() => setEscalateOpen(true)}>Escalate</Button>
            </PermissionGate>
          </div>
        }
      />

      {caseQuery.isLoading ? <LoadingSkeleton className="h-44 w-full" /> : null}
      {caseQuery.isError ? (
        <ErrorState title="Unable to load case details" description="Please retry shortly." onRetry={() => caseQuery.refetch()} />
      ) : null}

      {caseItem ? (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Case Summary</CardTitle>
                <CardDescription>{caseItem.summary}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={caseItem.status} />
                <StatusBadge status={caseItem.severity} />
                <StatusBadge status={caseItem.stage} />
              </div>
            </CardHeader>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Institution</p>
                <p className="font-medium text-foreground">{caseItem.institution}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Origin Complaint</p>
                <p className="font-medium text-foreground">{caseItem.sourceComplaint}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Jurisdiction</p>
                <p className="font-medium text-foreground">{caseItem.jurisdiction}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Assigned Officer</p>
                <p className="font-medium text-foreground">{caseItem.assignedOfficer}</p>
              </div>
            </div>
          </Card>

          <Tabs.Root defaultValue="overview" className="space-y-4">
            <Tabs.List className="inline-flex flex-wrap rounded-md border border-border bg-surface p-1">
              {['overview', 'timeline', 'notes', 'escalations', 'audit', 'related'].map((tab) => (
                <Tabs.Trigger
                  key={tab}
                  value={tab}
                  className="rounded px-3 py-1.5 text-sm capitalize data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {tab === 'related' ? 'Related Complaints' : tab}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="overview">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Overview</CardTitle>
                    <CardDescription>Current status and next required operational action.</CardDescription>
                  </div>
                </CardHeader>
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
                  <div><p className="text-xs text-muted">Case ID</p><p className="font-medium text-foreground">{caseItem.caseId}</p></div>
                  <div><p className="text-xs text-muted">Current Stage</p><p className="font-medium text-foreground">{caseItem.stage}</p></div>
                  <div><p className="text-xs text-muted">Next Action</p><p className="font-medium text-foreground">{caseItem.nextAction}</p></div>
                </div>
              </Card>
            </Tabs.Content>

            <Tabs.Content value="timeline">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Timeline</CardTitle>
                    <CardDescription>Chronological case activity feed.</CardDescription>
                  </div>
                </CardHeader>
                <Timeline>
                  {caseItem.timeline.map((item) => (
                    <TimelineItem key={item.id} title={item.title} badge={item.badge} timestamp={item.timestamp}>
                      {item.detail}
                    </TimelineItem>
                  ))}
                </Timeline>
              </Card>
            </Tabs.Content>

            <Tabs.Content value="notes">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Add Note</CardTitle>
                      <CardDescription>Capture investigation updates and context.</CardDescription>
                    </div>
                  </CardHeader>
                  <form
                    className="space-y-3"
                    onSubmit={handleSubmit(async (values) => {
                      await addCaseNote.mutateAsync({ caseId: id, message: values.message });
                      toast.success('Case note added');
                      reset();
                    })}
                  >
                    <textarea
                      {...register('message')}
                      className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      placeholder="Write note..."
                    />
                    {errors.message ? <p className="text-xs text-danger">{errors.message.message}</p> : null}
                    <div className="flex justify-end">
                      <PermissionGate permission="cases.update">
                        <Button type="submit" disabled={isSubmitting || addCaseNote.isPending}>
                          {isSubmitting || addCaseNote.isPending ? 'Saving...' : 'Add Note'}
                        </Button>
                      </PermissionGate>
                    </div>
                  </form>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                  </CardHeader>
                  <div className="space-y-3">
                    {(notesQuery.data ?? []).map((note) => (
                      <div key={note.id} className="rounded-md border border-border p-3">
                        <p className="text-sm text-foreground">{note.message}</p>
                        <p className="text-xs text-muted">{note.author} • {new Date(note.createdAt).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </Tabs.Content>

            <Tabs.Content value="escalations">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Escalations</CardTitle>
                    <CardDescription>Escalation history and routing actions.</CardDescription>
                  </div>
                </CardHeader>
                <div className="space-y-3">
                  {caseItem.escalations.map((item) => (
                    <div key={item.id} className="rounded-md border border-border p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <StatusBadge status={item.level} />
                        <p className="text-sm font-medium text-foreground">{item.target}</p>
                      </div>
                      <p className="text-sm text-muted">{item.reason}</p>
                      <p className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                  {!caseItem.escalations.length ? <p className="text-sm text-muted">No escalations yet.</p> : null}
                </div>
              </Card>
            </Tabs.Content>

            <Tabs.Content value="audit">
              <Card>
                <CardHeader>
                  <CardTitle>Audit</CardTitle>
                </CardHeader>
                <AuditTrailList />
              </Card>
            </Tabs.Content>

            <Tabs.Content value="related">
              <DataTable
                columns={relatedComplaintColumns}
                data={caseItem.relatedComplaints}
                total={caseItem.relatedComplaints.length}
                loading={false}
                pagination={relatedPagination}
                onPaginationChange={setRelatedPagination}
                pageCount={Math.max(1, Math.ceil(caseItem.relatedComplaints.length / relatedPagination.pageSize))}
              />
            </Tabs.Content>
          </Tabs.Root>
        </>
      ) : null}

      <AssignmentDrawer
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        targetLabel="Case"
        officers={officers}
        onSubmit={async (values) => {
          await assignCase.mutateAsync({
            caseId: id,
            assigneeId: values.assigneeId,
            dueDate: values.dueDate,
            priority: values.priority,
            comment: values.comment,
          });
        }}
      />

      <EscalateCaseDrawer
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        onSubmit={async (values) => {
          await escalateCase.mutateAsync({
            caseId: id,
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
