import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useDoctorSearch, type DoctorSearchRow } from '@/api/hooks/useDoctorSearch';

const specialties = ['cardiology', 'pediatrics', 'general practice', 'orthopedics', 'radiology'];
const states = ['Lagos', 'Abuja FCT', 'Rivers', 'Kano', 'Oyo', 'Kaduna'];

export function DoctorRegistryPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [hospital, setHospital] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const query = useDoctorSearch({
    q: q || undefined,
    specialization: specialty || undefined,
    state: stateFilter || undefined,
    hospital: hospital || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  const columns = useMemo<ColumnDef<DoctorSearchRow>[]>(
    () => [
      { accessorKey: 'doctorName', header: 'Doctor Name' },
      { accessorKey: 'specialty', header: 'Specialty' },
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'state', header: 'State' },
      {
        accessorKey: 'verificationStatus',
        header: 'Verification',
        cell: ({ row }) => <StatusBadge status={row.original.verificationStatus} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => navigate(`/app/public/doctor-registry/${row.original.doctorId}`)}>
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
        title="Doctor Registry Search"
        description="Find verified clinicians by name, specialty, state, and institution."
        breadcrumbs={[{ label: 'Public' }, { label: 'Doctor Registry' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search doctor name" />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={specialty}
            onChange={setSpecialty}
            placeholder="Specialty"
            loadOptions={async (search) =>
              specialties.filter((item) => item.includes(search.toLowerCase())).map((item) => ({ value: item, label: item }))
            }
          />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={stateFilter}
            onChange={setStateFilter}
            placeholder="State"
            loadOptions={async (search) =>
              states
                .filter((item) => item.toLowerCase().includes(search.toLowerCase()))
                .map((item) => ({ value: item, label: item }))
            }
          />
        </div>
        <div className="w-full md:max-w-sm">
          <SearchInput value={hospital} onChange={setHospital} placeholder="Hospital" />
        </div>
      </FilterBar>

      {query.isError ? (
        <ErrorState
          title="Unable to load doctor registry"
          description="Please retry after a moment."
          onRetry={() => query.refetch()}
        />
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
