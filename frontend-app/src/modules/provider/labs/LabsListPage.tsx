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
import { useLabs, type LabRow } from '@/api/hooks/useLabs';
import { useCompleteLab } from '@/api/hooks/useCompleteLab';

export function LabsListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [nin, setNin] = useState(searchParams.get('nin') ?? '');
  const [search, setSearch] = useState('');
  const [testType, setTestType] = useState('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [facility, setFacility] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const statusOptions = ['', 'pending', 'in_progress', 'completed', 'cancelled'];

  const completeLab = useCompleteLab();
  const query = useLabs(nin, {
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    from: from || undefined,
    to: to || undefined,
    q: search || undefined,
    encounterType: testType || undefined,
    status: status || undefined,
    clinician: provider || undefined,
    facility: facility || undefined,
  });

  const columns = useMemo<ColumnDef<LabRow>[]>(
    () => [
      { accessorKey: 'labRequestId', header: 'Lab Request ID' },
      { accessorKey: 'patientName', header: 'Patient Name' },
      { accessorKey: 'nin', header: 'NIN' },
      { accessorKey: 'testName', header: 'Test Type' },
      { accessorKey: 'provider', header: 'Requesting Provider' },
      { accessorKey: 'facility', header: 'Lab Facility' },
      { accessorKey: 'date', header: 'Requested Date' },
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
                Edit/Result
              </Button>
            </PermissionGate>
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/patient/${row.original.nin}`)}>
              Patient
            </Button>
            <PermissionGate permission="labs.complete">
              <Button
                size="sm"
                onClick={async () => {
                  await completeLab.mutateAsync({ labId: row.original.id, nin: row.original.nin });
                }}
              >
                Complete
              </Button>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [completeLab, navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lab Workflows"
        description="Manage lab requests, result entry, and completion workflows."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Labs' }]}
        actions={
          <PermissionGate permission="labs.create">
            <Button asChild>
              <Link to="/app/provider/labs/new">New Lab Request</Link>
            </Button>
          </PermissionGate>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-xs">
          <Input value={nin} onChange={(e) => setNin(e.target.value)} placeholder="Patient NIN (required)" />
        </div>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Patient, NIN, test type" />
        </div>
        <div className="w-full md:max-w-[170px]">
          <Input value={testType} onChange={(e) => setTestType(e.target.value)} placeholder="Test type" />
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
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Requesting provider" />
        </div>
        <div className="w-full md:max-w-[180px]">
          <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="Lab facility" />
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
              setTestType('');
              setStatus('');
              setProvider('');
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
        <EmptyState title="Enter patient NIN" description="Lab list requires a patient NIN to query records." />
      ) : query.isError ? (
        <ErrorState title="Unable to load lab requests" description="Please retry." onRetry={() => query.refetch()} />
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
