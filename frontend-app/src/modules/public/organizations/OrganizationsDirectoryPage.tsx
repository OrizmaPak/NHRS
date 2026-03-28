import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { usePublicOrganizations, type PublicOrganizationRow, type InstitutionType } from '@/api/hooks/useInstitutions';
import { useGeoLgas, useGeoStates } from '@/api/hooks/useGeography';

export function OrganizationsDirectoryPage() {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [lga, setLga] = useState('');
  const [institutionType, setInstitutionType] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const query = usePublicOrganizations({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: q || undefined,
    state: state || undefined,
    lga: lga || undefined,
    institutionType: (institutionType || undefined) as InstitutionType | undefined,
  });
  const geoStatesQuery = useGeoStates();
  const geoStates = geoStatesQuery.data ?? [];
  const selectedState = geoStates.find((entry) => entry.name.toLowerCase() === state.toLowerCase()) ?? null;
  const geoLgasQuery = useGeoLgas({
    stateId: selectedState?.stateId,
    includeInactive: false,
    enabled: Boolean(selectedState?.stateId),
  });
  const geoLgas = geoLgasQuery.data ?? [];
  const stateOptions = geoStates.map((entry) => ({ value: entry.name, label: entry.name }));
  const lgaOptions = geoLgas.map((entry) => ({ value: entry.name, label: entry.name }));

  const columns = useMemo<ColumnDef<PublicOrganizationRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Organization',
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link className="text-sm font-medium text-primary hover:underline" to={`/app/public/organizations/${row.original.organizationId}`}>
              {row.original.name}
            </Link>
            <p className="text-xs text-muted">{row.original.registrationNumber || 'No registration number'}</p>
          </div>
        ),
      },
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'lga', header: 'LGA' },
      { accessorKey: 'institutionsCount', header: 'Institutions' },
      {
        accessorKey: 'approvalStatus',
        header: 'Approval',
        cell: ({ row }) => <StatusBadge status={row.original.approvalStatus || 'approved'} />,
      },
      {
        accessorKey: 'lifecycleStatus',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.lifecycleStatus || row.original.status || 'active'} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <Link className="text-sm font-medium text-primary hover:underline" to={`/app/public/organizations/${row.original.organizationId}`}>
            Open
          </Link>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Public View"
        description="Search registered organizations and browse their published profile information."
        breadcrumbs={[{ label: 'Public' }, { label: 'Organizations' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search organization name, ID, or registration" />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={state || null}
            onChange={(next) => {
              setState(next);
              setLga('');
            }}
            placeholder={geoStatesQuery.isLoading ? 'Loading states...' : 'State'}
            debounceMs={200}
            loadOptions={async (input) =>
              stateOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
        </div>
        <div className="w-full md:max-w-xs">
          {selectedState ? (
            <SmartSelect
              value={lga || null}
              onChange={setLga}
              placeholder={geoLgasQuery.isLoading ? 'Loading LGAs...' : 'LGA'}
              debounceMs={200}
              loadOptions={async (input) =>
                lgaOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
          ) : (
            <input className="h-10 w-full rounded-md border border-border px-3 text-sm text-muted" value="" readOnly placeholder="Select state first" />
          )}
        </div>
        <select
          className="h-10 rounded-md border border-border px-3 text-sm"
          value={institutionType}
          onChange={(event) => setInstitutionType(event.target.value)}
        >
          <option value="">All Institution Types</option>
          <option value="hospital">Hospital</option>
          <option value="clinic">Clinic</option>
          <option value="laboratory">Laboratory</option>
          <option value="pharmacy">Pharmacy</option>
          <option value="government">Government</option>
          <option value="emergency">Emergency</option>
          <option value="catalog">Catalog</option>
        </select>
      </FilterBar>

      {query.isError ? (
        <ErrorState
          title="Unable to load organizations"
          description="Please retry organization search."
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
