import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ActionBar } from '@/components/data/ActionBar';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { usePatientSearch } from '@/api/hooks/usePatientSearch';
import { useCarePatients, type CarePatientRow } from '@/api/hooks/useCarePatients';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext, getOrganizationWorkspaceBasePath } from '@/lib/organizationContext';

export function PatientSearchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeContext = useContextStore((state) => state.activeContext);
  const [search, setSearch] = useState('');
  const [nin, setNin] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const careBasePath = getOrganizationWorkspaceBasePath(location.pathname, activeContext);
  const isCareWorkspace = careBasePath === '/app/care';
  const organizationId = getOrganizationIdFromContext(activeContext);
  const usesRegisteredSearch = activeContext?.type === 'organization';
  const resolvedPageDescription = usesRegisteredSearch
    ? 'Search patients already added into the organization patient register. Patients added anywhere in this organization appear here. If a patient is missing here, use Patient Intake first.'
    : 'Search patients by NIN or name.';

  const registeredQuery = useCarePatients({
    q: search || undefined,
    nin: nin || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    organizationId,
  }, usesRegisteredSearch);
  const platformQuery = usePatientSearch({
    q: search || undefined,
    nin: nin || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    viewMode: 'default',
    enabled: !usesRegisteredSearch,
  });
  const query = usesRegisteredSearch ? registeredQuery : platformQuery;

  const ninSuggestions = useMemo(
    () => (query.data?.rows ?? []).map((row) => ({ value: row.nin, label: row.nin })),
    [query.data?.rows],
  );

  const columns = useMemo<ColumnDef<CarePatientRow>[]>(
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
          <Button size="sm" variant="outline" onClick={() => navigate(`${careBasePath}/patient/${row.original.nin}`)}>
            View profile
          </Button>
        ),
      },
    ],
    [careBasePath, navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Search"
        description={resolvedPageDescription}
        breadcrumbs={[{ label: isCareWorkspace ? 'Patient Care' : 'Provider' }, { label: 'Patient Search' }]}
        actions={usesRegisteredSearch ? (
          <Button variant="outline" onClick={() => navigate(`${careBasePath}/intake`)}>
            Patient Intake
          </Button>
        ) : null}
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
          <ActionBar>
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setNin(null);
              }}
            >
              Clear filters
            </Button>
          </ActionBar>
        </div>
      </FilterBar>

      {query.isError ? (
        <ErrorState title="Unable to load patients" description="Please retry." onRetry={() => query.refetch()} />
      ) : usesRegisteredSearch && !query.isLoading && (query.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          title="No registered patients found"
          description="This search only shows patients already added into the organization patient register through Patient Intake. Add the patient first, then come back here."
          actionLabel="Open Patient Intake"
          onAction={() => navigate(`${careBasePath}/intake`)}
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

