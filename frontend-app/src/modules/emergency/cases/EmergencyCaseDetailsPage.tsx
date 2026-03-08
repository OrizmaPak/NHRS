import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useParams } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/data/DataTable';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { OperationalNotesPanel } from '@/components/operations/OperationalNotesPanel';
import { useAuthStore } from '@/stores/authStore';
import {
  useAddEmergencyCaseNote,
  useDispatchResource,
  useEmergencyCase,
  type EmergencyCaseResource,
  type LinkedPatient,
} from '@/api/hooks/useEmergencyCases';
import { DispatchResourceDrawer } from '@/modules/emergency/components/DispatchResourceDrawer';

export function EmergencyCaseDetailsPage() {
  const { id = '' } = useParams();
  const query = useEmergencyCase(id);
  const dispatchResource = useDispatchResource();
  const addCaseNote = useAddEmergencyCaseNote();
  const currentUser = useAuthStore((state) => state.user);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [resourcePagination, setResourcePagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [patientPagination, setPatientPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });

  const resourceColumns = useMemo<ColumnDef<EmergencyCaseResource>[]>(
    () => [
      { accessorKey: 'resourceType', header: 'Resource Type' },
      { accessorKey: 'originFacility', header: 'Origin Facility' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      { accessorKey: 'assignedTeam', header: 'Assigned Team' },
      { accessorKey: 'dispatchTime', header: 'Dispatch Time' },
    ],
    [],
  );

  const patientColumns = useMemo<ColumnDef<LinkedPatient>[]>(
    () => [
      { accessorKey: 'nin', header: 'NIN' },
      { accessorKey: 'name', header: 'Patient Name' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  const emergencyCase = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Emergency Case ${id}`}
        description="Operations center view for response coordination, dispatch, and communication."
        breadcrumbs={[{ label: 'Emergency' }, { label: 'Cases', href: '/app/emergency/cases' }, { label: id }]}
        actions={
          <PermissionGate permission="emergency.dispatch">
            <Button onClick={() => setDispatchOpen(true)}>Dispatch Resource</Button>
          </PermissionGate>
        }
      />

      {query.isLoading ? <LoadingSkeleton className="h-52 w-full" /> : null}
      {query.isError ? (
        <ErrorState title="Unable to load emergency case" description="Please retry." onRetry={() => query.refetch()} />
      ) : null}

      {emergencyCase ? (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{emergencyCase.incidentType.replace('_', ' ')}</CardTitle>
                <CardDescription>{emergencyCase.description || 'Emergency operations incident'}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={emergencyCase.priority} />
                <StatusBadge status={emergencyCase.status} />
              </div>
            </CardHeader>
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
              <div><p className="text-xs text-muted">Location</p><p className="text-foreground">{emergencyCase.state} / {emergencyCase.lga}</p></div>
              <div><p className="text-xs text-muted">Institution</p><p className="text-foreground">{emergencyCase.institution}</p></div>
              <div><p className="text-xs text-muted">Reported By</p><p className="text-foreground">{emergencyCase.reportedBy}</p></div>
              <div><p className="text-xs text-muted">Created Time</p><p className="text-foreground">{new Date(emergencyCase.createdAt).toLocaleString()}</p></div>
            </div>
          </Card>

          <Tabs.Root defaultValue="overview" className="space-y-4">
            <Tabs.List className="inline-flex flex-wrap rounded-md border border-border bg-surface p-1">
              <Tabs.Trigger value="overview" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Overview</Tabs.Trigger>
              <Tabs.Trigger value="resources" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Resources</Tabs.Trigger>
              <Tabs.Trigger value="timeline" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Timeline</Tabs.Trigger>
              <Tabs.Trigger value="notes" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Notes</Tabs.Trigger>
              <Tabs.Trigger value="patients" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Linked Patients</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="overview">
              <Card>
                <CardHeader>
                  <CardTitle>Incident Overview</CardTitle>
                  <CardDescription>Current response posture and institutional scope.</CardDescription>
                </CardHeader>
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                  <div><p className="text-xs text-muted">Incident Summary</p><p className="text-foreground">{emergencyCase.description || emergencyCase.incidentType}</p></div>
                  <div><p className="text-xs text-muted">Affected Institution</p><p className="text-foreground">{emergencyCase.institution}</p></div>
                  <div><p className="text-xs text-muted">Reporting Authority</p><p className="text-foreground">{emergencyCase.reportedBy}</p></div>
                  <div><p className="text-xs text-muted">Current Response</p><p className="text-foreground">{emergencyCase.status}</p></div>
                </div>
              </Card>
            </Tabs.Content>

            <Tabs.Content value="resources">
              <DataTable
                columns={resourceColumns}
                data={emergencyCase.resources}
                total={emergencyCase.resources.length}
                loading={query.isLoading}
                pagination={resourcePagination}
                onPaginationChange={setResourcePagination}
                pageCount={Math.max(1, Math.ceil((emergencyCase.resources.length || 0) / resourcePagination.pageSize))}
              />
            </Tabs.Content>

            <Tabs.Content value="timeline">
              <Card>
                <CardHeader>
                  <CardTitle>Operational Timeline</CardTitle>
                </CardHeader>
                <Timeline>
                  {emergencyCase.timeline.map((entry) => (
                    <TimelineItem key={entry.id} title={entry.title} timestamp={entry.timestamp} badge={entry.badge}>
                      {entry.description}
                    </TimelineItem>
                  ))}
                </Timeline>
              </Card>
            </Tabs.Content>

            <Tabs.Content value="notes">
              <OperationalNotesPanel
                notes={(emergencyCase.notes ?? []).map((note) => ({
                  id: note.id,
                  author: note.author,
                  userId: undefined,
                  timestamp: note.createdAt,
                  content: note.content,
                }))}
                currentUserId={currentUser?.id}
                onAdd={async (content) => {
                  await addCaseNote.mutateAsync({ caseId: emergencyCase.id, message: content });
                  toast.success('Operational note added');
                }}
              />
            </Tabs.Content>

            <Tabs.Content value="patients">
              <DataTable
                columns={patientColumns}
                data={emergencyCase.linkedPatients}
                total={emergencyCase.linkedPatients.length}
                loading={query.isLoading}
                pagination={patientPagination}
                onPaginationChange={setPatientPagination}
                pageCount={Math.max(1, Math.ceil((emergencyCase.linkedPatients.length || 0) / patientPagination.pageSize))}
              />
            </Tabs.Content>
          </Tabs.Root>

          <DispatchResourceDrawer
            open={dispatchOpen}
            onOpenChange={setDispatchOpen}
            onDispatch={async (values) => {
              await dispatchResource.mutateAsync({
                caseId: emergencyCase.id,
                resourceType: values.resourceType,
                originInstitution: values.originInstitution,
                destination: values.destination,
                priority: values.priority,
                notes: values.notes,
              });
              toast.success('Resource dispatched successfully');
            }}
          />
        </>
      ) : null}
    </div>
  );
}

