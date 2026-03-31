import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { ActionBar } from '@/components/data/ActionBar';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { usePatientProfile } from '@/api/hooks/usePatientProfile';
import { useEncounters, type EncounterRow } from '@/api/hooks/useEncounters';
import { useLabs, type LabRow } from '@/api/hooks/useLabs';
import { usePharmacyRecords, type PharmacyRow } from '@/api/hooks/usePharmacyRecords';
import { usePatientHistory } from '@/api/hooks/usePatientHistory';
import { usePatientTimeline, type PatientTimelineEntry } from '@/api/hooks/usePatientTimeline';
import { exportRowsToCsv, exportRowsToExcelLike } from '@/lib/export';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { getOrganizationIdFromContext, getOrganizationWorkspaceBasePath } from '@/lib/organizationContext';

type TabKey = 'encounters' | 'labs' | 'pharmacy' | 'history' | 'timeline';

export function PatientProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { nin = '' } = useParams();
  const activeContext = useContextStore((state) => state.activeContext);
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const [encounterPagination, setEncounterPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [labsPagination, setLabsPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [pharmacyPagination, setPharmacyPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [historyPagination, setHistoryPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [timelinePagination, setTimelinePagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });

  const basePath = getOrganizationWorkspaceBasePath(location.pathname, activeContext);
  const isCareWorkspace = basePath === '/app/care';
  const isOrganizationScopedPatientView = activeContext?.type === 'organization';
  const organizationId = getOrganizationIdFromContext(activeContext);
  const workspaceLabel = isCareWorkspace ? 'Patient Care' : 'Provider';

  const canReadEncounters = !isCareWorkspace && hasPermission('encounters.read');
  const canReadLabs = !isCareWorkspace && hasPermission('labs.read');
  const canReadPharmacy = !isCareWorkspace && hasPermission('pharmacy.read');
  const canReadTimeline = isCareWorkspace && hasPermission('records.nin.read');

  const profileQuery = usePatientProfile(nin, {
    viewMode: isOrganizationScopedPatientView ? 'patient-care' : 'default',
    organizationId,
  });
  const encountersQuery = useEncounters(nin, { page: encounterPagination.pageIndex + 1, limit: encounterPagination.pageSize }, canReadEncounters);
  const labsQuery = useLabs(nin, { page: labsPagination.pageIndex + 1, limit: labsPagination.pageSize }, canReadLabs);
  const pharmacyQuery = usePharmacyRecords(nin, { page: pharmacyPagination.pageIndex + 1, limit: pharmacyPagination.pageSize }, canReadPharmacy);
  const historyQuery = usePatientHistory(nin, !isCareWorkspace && (canReadEncounters || canReadLabs || canReadPharmacy));
  const timelineQuery = usePatientTimeline(nin, canReadTimeline);

  const encounterColumns = useMemo<ColumnDef<EncounterRow>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'encounterId', header: 'Encounter ID' },
      { accessorKey: 'visitType', header: 'Visit Type' },
      { accessorKey: 'diagnosis', header: 'Diagnosis' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/encounters/${row.original.id}`)}>
              View
            </Button>
            <PermissionGate permission="encounters.update">
              <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/encounters/${row.original.id}/edit`)}>
                Edit
              </Button>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [navigate],
  );

  const labColumns = useMemo<ColumnDef<LabRow>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'labRequestId', header: 'Lab ID' },
      { accessorKey: 'testName', header: 'Test' },
      { accessorKey: 'facility', header: 'Facility' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/labs/${row.original.id}`)}>
              View
            </Button>
            <PermissionGate permission="labs.update">
              <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/labs/${row.original.id}/edit`)}>
                Result
              </Button>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [navigate],
  );

  const pharmacyColumns = useMemo<ColumnDef<PharmacyRow>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'prescriptionId', header: 'Prescription ID' },
      { accessorKey: 'medication', header: 'Medication' },
      { accessorKey: 'dosage', header: 'Dosage' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/pharmacy/${row.original.id}`)}>
              View
            </Button>
            <PermissionGate permission="pharmacy.dispense">
              <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/pharmacy/${row.original.id}/edit`)}>
                Dispense
              </Button>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [navigate],
  );

  const historyColumns = useMemo<ColumnDef<(typeof historyQuery.history)[number]>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'type', header: 'Type' },
      { accessorKey: 'title', header: 'Title' },
      { accessorKey: 'summary', header: 'Summary' },
      { accessorKey: 'provider', header: 'Provider' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  const timelineColumns = useMemo<ColumnDef<PatientTimelineEntry>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'recordType', header: 'Entry Type' },
      { accessorKey: 'sourceLabel', header: 'Source' },
      { accessorKey: 'description', header: 'Summary' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  const availableTabs = useMemo<Array<{ key: TabKey; label: string }>>(() => {
    if (isCareWorkspace) {
      return canReadTimeline ? [{ key: 'timeline', label: 'Timeline' }] : [];
    }

    const tabs: Array<{ key: TabKey; label: string }> = [];
    if (canReadEncounters) tabs.push({ key: 'encounters', label: 'Encounters' });
    if (canReadLabs) tabs.push({ key: 'labs', label: 'Labs' });
    if (canReadPharmacy) tabs.push({ key: 'pharmacy', label: 'Pharmacy' });
    if (canReadEncounters || canReadLabs || canReadPharmacy) {
      tabs.push({ key: 'history', label: 'History' });
    }
    return tabs;
  }, [canReadEncounters, canReadLabs, canReadPharmacy, canReadTimeline, isCareWorkspace]);

  const defaultTab = availableTabs[0]?.key ?? 'timeline';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Profile"
        description={isCareWorkspace ? 'Patient summary and timeline visible from the active institution or branch care workspace.' : 'Encounter, lab, pharmacy, and activity history for provider operations.'}
        breadcrumbs={[{ label: workspaceLabel }, { label: 'Patient Search' }, { label: 'Profile' }]}
      />

      {profileQuery.isLoading ? <LoadingSkeleton className="h-32 w-full" /> : null}
      {profileQuery.isError ? (
        <ErrorState title="Unable to load patient profile" description="Please retry." onRetry={() => profileQuery.refetch()} />
      ) : null}

      {!profileQuery.isLoading && !profileQuery.isError && profileQuery.data ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-foreground">{profileQuery.data.name}</h2>
              <p className="text-sm text-muted">NIN: {profileQuery.data.nin}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md border border-border px-2 py-1">Age: {profileQuery.data.age ?? 'N/A'}</span>
              <span className="rounded-md border border-border px-2 py-1">Gender: {profileQuery.data.gender}</span>
              <StatusBadge status="verified" />
            </div>
          </div>
          <div className="mt-4">
            <ActionBar>
              {!isCareWorkspace ? (
                <>
                  <PermissionGate permission="encounters.create">
                    <Button asChild>
                      <Link to={`/app/provider/patient/${nin}/encounters/new`}>New Encounter</Link>
                    </Button>
                  </PermissionGate>
                  <PermissionGate permission="labs.create">
                    <Button asChild variant="outline">
                      <Link to={`/app/provider/patient/${nin}/labs/new`}>New Lab Request</Link>
                    </Button>
                  </PermissionGate>
                  <PermissionGate permission="pharmacy.create">
                    <Button asChild variant="outline">
                      <Link to={`/app/provider/patient/${nin}/pharmacy/new`}>New Prescription</Link>
                    </Button>
                  </PermissionGate>
                </>
              ) : null}
              <Button
                variant="outline"
                onClick={() =>
                  exportRowsToCsv(
                    isCareWorkspace ? 'patient-care-timeline' : 'patient-history',
                    (isCareWorkspace ? timelineQuery.data ?? [] : historyQuery.history) as unknown as Array<Record<string, unknown>>,
                  )
                }
              >
                Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  exportRowsToExcelLike(
                    isCareWorkspace ? 'patient-care-timeline' : 'patient-history',
                    (isCareWorkspace ? timelineQuery.data ?? [] : historyQuery.history) as unknown as Array<Record<string, unknown>>,
                  )
                }
              >
                Export Excel
              </Button>
            </ActionBar>
          </div>
        </Card>
      ) : null}

      {availableTabs.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No patient activity view is enabled for this scope"
            description="This profile is available, but the current role does not yet include a timeline or provider-history read permission."
          />
        </Card>
      ) : (
        <Tabs.Root defaultValue={defaultTab} className="space-y-4">
          <Tabs.List className="inline-flex flex-wrap rounded-md border border-border bg-surface p-1">
            {availableTabs.map((tab) => (
              <Tabs.Trigger
                key={tab.key}
                value={tab.key}
                className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {canReadEncounters ? (
            <Tabs.Content value="encounters">
              <DataTable
                columns={encounterColumns}
                data={encountersQuery.data?.rows ?? []}
                total={encountersQuery.data?.total ?? 0}
                loading={encountersQuery.isLoading}
                pagination={encounterPagination}
                onPaginationChange={setEncounterPagination}
                pageCount={Math.max(1, Math.ceil((encountersQuery.data?.total ?? 0) / encounterPagination.pageSize))}
              />
            </Tabs.Content>
          ) : null}

          {canReadLabs ? (
            <Tabs.Content value="labs">
              <DataTable
                columns={labColumns}
                data={labsQuery.data?.rows ?? []}
                total={labsQuery.data?.total ?? 0}
                loading={labsQuery.isLoading}
                pagination={labsPagination}
                onPaginationChange={setLabsPagination}
                pageCount={Math.max(1, Math.ceil((labsQuery.data?.total ?? 0) / labsPagination.pageSize))}
              />
            </Tabs.Content>
          ) : null}

          {canReadPharmacy ? (
            <Tabs.Content value="pharmacy">
              <DataTable
                columns={pharmacyColumns}
                data={pharmacyQuery.data?.rows ?? []}
                total={pharmacyQuery.data?.total ?? 0}
                loading={pharmacyQuery.isLoading}
                pagination={pharmacyPagination}
                onPaginationChange={setPharmacyPagination}
                pageCount={Math.max(1, Math.ceil((pharmacyQuery.data?.total ?? 0) / pharmacyPagination.pageSize))}
              />
            </Tabs.Content>
          ) : null}

          {!isCareWorkspace && (canReadEncounters || canReadLabs || canReadPharmacy) ? (
            <Tabs.Content value="history">
              <div className="space-y-4">
                <Card>
                  <h3 className="text-base font-semibold text-foreground">Clinical Activity Timeline</h3>
                  <p className="mt-1 text-sm text-muted">Chronological stream merged from encounters, labs, and pharmacy events.</p>
                  <div className="mt-4">
                    <Timeline>
                      {historyQuery.history.slice(0, 10).map((item) => (
                        <TimelineItem
                          key={`timeline-${item.id}`}
                          title={`${item.type.toUpperCase()} - ${item.title}`}
                          timestamp={item.date}
                          badge={item.provider}
                        >
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-foreground">{item.summary}</p>
                            <StatusBadge status={item.status} />
                          </div>
                        </TimelineItem>
                      ))}
                    </Timeline>
                  </div>
                </Card>
                <DataTable
                  columns={historyColumns}
                  data={historyQuery.history}
                  total={historyQuery.history.length}
                  loading={historyQuery.isLoading}
                  pagination={historyPagination}
                  onPaginationChange={setHistoryPagination}
                  pageCount={Math.max(1, Math.ceil((historyQuery.history.length || 0) / historyPagination.pageSize))}
                />
              </div>
            </Tabs.Content>
          ) : null}

          {canReadTimeline ? (
            <Tabs.Content value="timeline">
              <div className="space-y-4">
                <Card>
                  <h3 className="text-base font-semibold text-foreground">Patient Timeline</h3>
                  <p className="mt-1 text-sm text-muted">Timeline entries already recorded for this patient and visible to the active institution or branch scope.</p>
                  <div className="mt-4">
                    {timelineQuery.isError ? (
                      <ErrorState title="Unable to load patient timeline" description="Please retry." onRetry={() => timelineQuery.refetch()} />
                    ) : timelineQuery.isLoading ? (
                      <div className="space-y-3">
                        <LoadingSkeleton className="h-20 w-full" />
                        <LoadingSkeleton className="h-20 w-full" />
                      </div>
                    ) : (timelineQuery.data?.length ?? 0) === 0 ? (
                      <EmptyState
                        title="No timeline entries yet"
                        description="This patient does not yet have timeline activity visible from the current care scope."
                      />
                    ) : (
                      <Timeline>
                        {(timelineQuery.data ?? []).slice(0, 10).map((item) => (
                          <TimelineItem
                            key={`care-timeline-${item.id}`}
                            title={item.recordType.replace(/_/g, ' ')}
                            timestamp={item.date}
                            badge={item.sourceLabel}
                          >
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-foreground">{item.description}</p>
                              <StatusBadge status={item.status} />
                            </div>
                          </TimelineItem>
                        ))}
                      </Timeline>
                    )}
                  </div>
                </Card>
                <DataTable
                  columns={timelineColumns}
                  data={timelineQuery.data ?? []}
                  total={timelineQuery.data?.length ?? 0}
                  loading={timelineQuery.isLoading}
                  pagination={timelinePagination}
                  onPaginationChange={setTimelinePagination}
                  pageCount={Math.max(1, Math.ceil(((timelineQuery.data?.length ?? 0) || 0) / timelinePagination.pageSize))}
                />
              </div>
            </Tabs.Content>
          ) : null}
        </Tabs.Root>
      )}
    </div>
  );
}
