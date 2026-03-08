import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { ActionBar } from '@/components/data/ActionBar';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { Timeline } from '@/components/data/Timeline';
import { TimelineItem } from '@/components/data/TimelineItem';
import { usePatientProfile } from '@/api/hooks/usePatientProfile';
import { useEncounters, type EncounterRow } from '@/api/hooks/useEncounters';
import { useLabs, type LabRow } from '@/api/hooks/useLabs';
import { usePharmacyRecords, type PharmacyRow } from '@/api/hooks/usePharmacyRecords';
import { usePatientHistory } from '@/api/hooks/usePatientHistory';
import { exportRowsToCsv, exportRowsToExcelLike } from '@/lib/export';

export function PatientProfilePage() {
  const navigate = useNavigate();
  const { nin = '' } = useParams();
  const [encounterPagination, setEncounterPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [labsPagination, setLabsPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [pharmacyPagination, setPharmacyPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [historyPagination, setHistoryPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });

  const profileQuery = usePatientProfile(nin);
  const encountersQuery = useEncounters(nin, { page: encounterPagination.pageIndex + 1, limit: encounterPagination.pageSize });
  const labsQuery = useLabs(nin, { page: labsPagination.pageIndex + 1, limit: labsPagination.pageSize });
  const pharmacyQuery = usePharmacyRecords(nin, { page: pharmacyPagination.pageIndex + 1, limit: pharmacyPagination.pageSize });
  const historyQuery = usePatientHistory(nin);

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
    [historyQuery.history],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Profile"
        description="Encounter, lab, pharmacy, and activity history for provider operations."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Patient Search' }, { label: 'Profile' }]}
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
              <Button
                variant="outline"
                onClick={() => exportRowsToCsv('patient-metrics', historyQuery.history as unknown as Array<Record<string, unknown>>)}
              >
                Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={() => exportRowsToExcelLike('patient-metrics', historyQuery.history as unknown as Array<Record<string, unknown>>)}
              >
                Export Excel
              </Button>
            </ActionBar>
          </div>
        </Card>
      ) : null}

      <Tabs.Root defaultValue="encounters" className="space-y-4">
        <Tabs.List className="inline-flex flex-wrap rounded-md border border-border bg-surface p-1">
          <Tabs.Trigger value="encounters" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Encounters
          </Tabs.Trigger>
          <Tabs.Trigger value="labs" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Labs
          </Tabs.Trigger>
          <Tabs.Trigger value="pharmacy" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Pharmacy
          </Tabs.Trigger>
          <Tabs.Trigger value="history" className="rounded px-3 py-1.5 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            History
          </Tabs.Trigger>
        </Tabs.List>

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
      </Tabs.Root>
    </div>
  );
}
