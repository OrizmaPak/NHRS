import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { ActionBar } from '@/components/data/ActionBar';
import { DataTable } from '@/components/data/DataTable';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useEncounters, type EncounterRow } from '@/api/hooks/useEncounters';
import { useFinalizeEncounter } from '@/api/hooks/useFinalizeEncounter';

export function EncountersListPage() {
  const navigate = useNavigate();
  const [nin, setNin] = useState('');
  const [search, setSearch] = useState('');
  const [encounterType, setEncounterType] = useState('');
  const [status, setStatus] = useState('');
  const [clinician, setClinician] = useState('');
  const [facility, setFacility] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const encounterTypes = ['', 'outpatient', 'inpatient', 'emergency'];
  const statusOptions = ['', 'draft', 'in_progress', 'finalized'];

  const finalizeEncounter = useFinalizeEncounter();
  const query = useEncounters(nin, {
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    from: from || undefined,
    to: to || undefined,
    q: search || undefined,
    encounterType: encounterType || undefined,
    status: status || undefined,
    clinician: clinician || undefined,
    facility: facility || undefined,
  });

  const columns = useMemo<ColumnDef<EncounterRow>[]>(
    () => [
      { accessorKey: 'encounterId', header: 'Encounter ID' },
      { accessorKey: 'patientName', header: 'Patient Name' },
      { accessorKey: 'nin', header: 'NIN' },
      { accessorKey: 'visitType', header: 'Encounter Type' },
      { accessorKey: 'provider', header: 'Provider/Facility' },
      { accessorKey: 'clinician', header: 'Attending Clinician' },
      { accessorKey: 'date', header: 'Date' },
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
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/patient/${row.original.nin}`)}>
              Patient
            </Button>
            <PermissionGate permission="encounters.finalize">
              <Button
                size="sm"
                onClick={async () => {
                  await finalizeEncounter.mutateAsync({ encounterId: row.original.id, nin: row.original.nin });
                }}
              >
                Finalize
              </Button>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [finalizeEncounter, navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Encounters"
        description="Create, review, and manage encounter records."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Encounters' }]}
        actions={
          <PermissionGate permission="encounters.create">
            <Button asChild>
              <Link to="/app/provider/encounters/new">New Encounter</Link>
            </Button>
          </PermissionGate>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-xs">
          <Input value={nin} onChange={(e) => setNin(e.target.value)} placeholder="Patient NIN (required)" />
        </div>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Patient, NIN, diagnosis" />
        </div>
        <div className="w-full md:max-w-[160px]">
          <select
            value={encounterType}
            onChange={(e) => setEncounterType(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            {encounterTypes.map((type) => (
              <option key={type || 'all'} value={type}>
                {type || 'All types'}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full md:max-w-[150px]">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            {statusOptions.map((value) => (
              <option key={value || 'all'} value={value}>
                {value || 'All statuses'}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full md:max-w-[180px]">
          <Input value={clinician} onChange={(e) => setClinician(e.target.value)} placeholder="Clinician" />
        </div>
        <div className="w-full md:max-w-[180px]">
          <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="Facility" />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <ActionBar>
          <Button variant="outline" onClick={() => { setSearch(''); setEncounterType(''); setStatus(''); setClinician(''); setFacility(''); setFrom(''); setTo(''); }}>
            Clear
          </Button>
        </ActionBar>
      </FilterBar>

      {!nin ? (
        <EmptyState title="Enter patient NIN" description="Encounters list requires a patient NIN to query records." />
      ) : query.isError ? (
        <ErrorState title="Unable to load encounters" description="Please retry." onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.rows ?? []}
          total={query.data?.total ?? 0}
          loading={query.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / pagination.pageSize))}
        />
      )}
    </div>
  );
}
