import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useNavigate } from 'react-router-dom';
import { ActionBar } from '@/components/data/ActionBar';
import { DataTable } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';

type Patient = {
  id: string;
  name: string;
  nin: string;
  phone: string;
  status: string;
};

const patientRows: Patient[] = [
  { id: 'p-1', name: 'Amina Ibrahim', nin: '90000000001', phone: '+2348000000001', status: 'active' },
  { id: 'p-2', name: 'David Eze', nin: '90000000044', phone: '+2348000000032', status: 'active' },
  { id: 'p-3', name: 'Grace Bello', nin: '90000000110', phone: '+2348000000067', status: 'pending' },
];

export function PatientSearchPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const filtered = patientRows.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()) || row.nin.includes(search));

  const columns = useMemo<ColumnDef<Patient>[]>(
    () => [
      { accessorKey: 'name', header: 'Patient Name' },
      { accessorKey: 'nin', header: 'NIN' },
      { accessorKey: 'phone', header: 'Phone' },
      { accessorKey: 'status', header: 'Status' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => navigate(`/provider/patients/${row.original.id}`)}>
            Open
          </Button>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Patient Search"
        description="Find patients by NIN, phone, or profile details with branch-aware context filters."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Patient Search' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by NIN or name" />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={branch}
            onChange={setBranch}
            placeholder="Filter by branch"
            loadOptions={async () => [
              { value: 'branch-main', label: 'Main Campus' },
              { value: 'branch-west', label: 'West Clinic' },
            ]}
          />
        </div>
        <ActionBar>
          <Button variant="outline">Advanced filters</Button>
        </ActionBar>
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        total={filtered.length}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageCount={1}
      />
    </div>
  );
}
