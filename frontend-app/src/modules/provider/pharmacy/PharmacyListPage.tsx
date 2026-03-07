import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { usePharmacyRecords, type PharmacyRow } from '@/api/hooks/usePharmacyRecords';

export function PharmacyListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [nin, setNin] = useState(searchParams.get('nin') ?? '');
  const [search, setSearch] = useState('');
  const [medication, setMedication] = useState('');
  const [status, setStatus] = useState('');
  const [prescriber, setPrescriber] = useState('');
  const [facility, setFacility] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const query = usePharmacyRecords(nin, {
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    from: from || undefined,
    to: to || undefined,
    q: `${search} ${medication}`.trim() || undefined,
    status: status || undefined,
    clinician: prescriber || undefined,
    facility: facility || undefined,
  });

  const columns = useMemo<ColumnDef<PharmacyRow>[]>(
    () => [
      { accessorKey: 'prescriptionId', header: 'Prescription ID' },
      { accessorKey: 'patientName', header: 'Patient Name' },
      { accessorKey: 'nin', header: 'NIN' },
      { accessorKey: 'medication', header: 'Medication Summary' },
      { accessorKey: 'provider', header: 'Prescriber' },
      { accessorKey: 'facility', header: 'Pharmacy/Facility' },
      { accessorKey: 'date', header: 'Prescribed Date' },
      {
        accessorKey: 'status',
        header: 'Dispense Status',
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
            <PermissionGate permission="pharmacy.update">
              <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/pharmacy/${row.original.id}?mode=edit`)}>
                Edit/Dispense
              </Button>
            </PermissionGate>
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/patient/${row.original.nin}`)}>
              Patient
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pharmacy Workflows"
        description="Manage prescriptions, dispensing, and medication history operations."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Pharmacy' }]}
        actions={
          <PermissionGate permission="pharmacy.create">
            <Button asChild>
              <Link to="/app/provider/pharmacy/new">New Prescription</Link>
            </Button>
          </PermissionGate>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-xs">
          <Input value={nin} onChange={(e) => setNin(e.target.value)} placeholder="Patient NIN (required)" />
        </div>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Patient, NIN, medication" />
        </div>
        <div className="w-full md:max-w-[180px]">
          <Input value={medication} onChange={(e) => setMedication(e.target.value)} placeholder="Medication" />
        </div>
        <div className="w-full md:max-w-[150px]">
          <Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Status" />
        </div>
        <div className="w-full md:max-w-[180px]">
          <Input value={prescriber} onChange={(e) => setPrescriber(e.target.value)} placeholder="Prescriber" />
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
          <Button
            variant="outline"
            onClick={() => {
              setSearch('');
              setMedication('');
              setStatus('');
              setPrescriber('');
              setFacility('');
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </Button>
        </ActionBar>
      </FilterBar>

      {!nin ? (
        <EmptyState title="Enter patient NIN" description="Pharmacy list requires a patient NIN to query records." />
      ) : query.isError ? (
        <ErrorState title="Unable to load prescriptions" description="Please retry." onRetry={() => query.refetch()} />
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
