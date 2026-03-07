import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { usePatientProfile } from '@/api/hooks/usePatientProfile';
import { useEncounters, type EncounterRow } from '@/api/hooks/useEncounters';
import { useLabs, type LabRow } from '@/api/hooks/useLabs';
import { usePharmacyRecords, type PharmacyRow } from '@/api/hooks/usePharmacyRecords';

export function PatientProfilePage() {
  const { nin = '' } = useParams();
  const [encounterPagination, setEncounterPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [labsPagination, setLabsPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [pharmacyPagination, setPharmacyPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });

  const profileQuery = usePatientProfile(nin);
  const encountersQuery = useEncounters(nin, { page: encounterPagination.pageIndex + 1, limit: encounterPagination.pageSize });
  const labsQuery = useLabs(nin, { page: labsPagination.pageIndex + 1, limit: labsPagination.pageSize });
  const pharmacyQuery = usePharmacyRecords(nin, { page: pharmacyPagination.pageIndex + 1, limit: pharmacyPagination.pageSize });

  const encounterColumns = useMemo<ColumnDef<EncounterRow>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'visitType', header: 'Visit Type' },
      { accessorKey: 'diagnosis', header: 'Diagnosis' },
      { accessorKey: 'provider', header: 'Provider' },
    ],
    [],
  );

  const labColumns = useMemo<ColumnDef<LabRow>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'testName', header: 'Test' },
      { accessorKey: 'interpretation', header: 'Interpretation' },
      { accessorKey: 'provider', header: 'Provider' },
    ],
    [],
  );

  const pharmacyColumns = useMemo<ColumnDef<PharmacyRow>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'medication', header: 'Medication' },
      { accessorKey: 'dosage', header: 'Dosage' },
      { accessorKey: 'provider', header: 'Provider' },
    ],
    [],
  );

  const historyPagination = useMemo<PaginationState>(() => ({ pageIndex: 0, pageSize: 12 }), []);
  const historyRows = useMemo(
    () =>
      [
        ...(encountersQuery.data?.rows ?? []).map((row) => ({
          id: `enc-${row.id}`,
          source: 'Encounter',
          date: row.date,
          summary: row.diagnosis,
          provider: row.provider,
          status: 'active',
        })),
        ...(labsQuery.data?.rows ?? []).map((row) => ({
          id: `lab-${row.id}`,
          source: 'Lab',
          date: row.date,
          summary: row.testName,
          provider: row.provider,
          status: 'verified',
        })),
        ...(pharmacyQuery.data?.rows ?? []).map((row) => ({
          id: `pharm-${row.id}`,
          source: 'Pharmacy',
          date: row.date,
          summary: row.medication,
          provider: row.provider,
          status: 'active',
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [encountersQuery.data?.rows, labsQuery.data?.rows, pharmacyQuery.data?.rows],
  );

  const historyColumns = useMemo<ColumnDef<(typeof historyRows)[number]>[]>(
    () => [
      { accessorKey: 'date', header: 'Date' },
      { accessorKey: 'source', header: 'Type' },
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Profile"
        description="Clinical record tabs with server-side pagination."
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
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-md border border-border px-2 py-1">Age: {profileQuery.data.age ?? 'N/A'}</span>
              <span className="rounded-md border border-border px-2 py-1">Gender: {profileQuery.data.gender}</span>
              <StatusBadge status="verified" />
            </div>
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
          <DataTable
            columns={historyColumns}
            data={historyRows}
            total={historyRows.length}
            loading={encountersQuery.isLoading || labsQuery.isLoading || pharmacyQuery.isLoading}
            pagination={historyPagination}
            onPaginationChange={() => undefined}
            pageCount={1}
          />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
