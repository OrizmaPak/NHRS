import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ActionBar } from '@/components/data/ActionBar';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/feedback/ErrorState';
import { usePatientSearch, type PatientSearchRow } from '@/api/hooks/usePatientSearch';

export function PatientSearchPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [nin, setNin] = useState<string | null>(null);
  const [dob, setDob] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const query = usePatientSearch({
    q: search || undefined,
    nin: nin || undefined,
    dob: dob || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  const ninSuggestions = useMemo(
    () => (query.data?.rows ?? []).map((row) => ({ value: row.nin, label: row.nin })),
    [query.data?.rows],
  );

  const columns = useMemo<ColumnDef<PatientSearchRow>[]>(
    () => [
      { accessorKey: 'nin', header: 'NIN' },
      { accessorKey: 'patientName', header: 'Patient Name' },
      {
        accessorKey: 'age',
        header: 'Age',
        cell: ({ row }) => row.original.age ?? 'N/A',
      },
      { accessorKey: 'gender', header: 'Gender' },
      { accessorKey: 'lastActivity', header: 'Last Activity' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => navigate(`/app/provider/patient/${row.original.nin}`)}>
            View profile
          </Button>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Search"
        description="Search patients by NIN, name, and date of birth."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Patient Search' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Patient name" />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={nin}
            onChange={setNin}
            placeholder="NIN"
            loadOptions={async (input) =>
              ninSuggestions.filter((option) => option.value.includes(input)).slice(0, 20)
            }
          />
        </div>
        <div className="w-full md:max-w-xs">
          <Input type="date" value={dob} onChange={(event) => setDob(event.target.value)} aria-label="Date of birth" />
        </div>
        <ActionBar>
          <Button
            variant="outline"
            onClick={() => {
              setSearch('');
              setNin(null);
              setDob('');
            }}
          >
            Clear filters
          </Button>
        </ActionBar>
      </FilterBar>

      {query.isError ? (
        <ErrorState title="Unable to load patients" description="Please retry." onRetry={() => query.refetch()} />
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
