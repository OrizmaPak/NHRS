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
import { ActionBar } from '@/components/data/ActionBar';
import { ErrorState } from '@/components/feedback/ErrorState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useEmergencyInventory, type EmergencyInventoryRow } from '@/api/hooks/useEmergencyInventory';

const resourceTypes = ['drug', 'blood', 'equipment', 'service'];
const states = ['Lagos', 'Abuja FCT', 'Rivers', 'Kano', 'Oyo', 'Kaduna'];

export function EmergencyInventoryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [itemType, setItemType] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const query = useEmergencyInventory({
    q: search || undefined,
    itemType: itemType || undefined,
    state: stateFilter || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  const columns = useMemo<ColumnDef<EmergencyInventoryRow>[]>(
    () => [
      { accessorKey: 'resourceName', header: 'Resource' },
      { accessorKey: 'provider', header: 'Provider' },
      { accessorKey: 'state', header: 'State' },
      {
        accessorKey: 'availability',
        header: 'Availability',
        cell: ({ row }) => <StatusBadge status={row.original.availability} />,
      },
      { accessorKey: 'lastUpdated', header: 'Last Updated' },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emergency Inventory"
        description="Live inventory visibility for emergency response coordination."
        breadcrumbs={[{ label: 'Emergency' }, { label: 'Inventory' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search resource or provider" />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={itemType}
            onChange={setItemType}
            placeholder="Resource type"
            loadOptions={async (input) =>
              resourceTypes
                .filter((item) => item.includes(input.toLowerCase()))
                .map((item) => ({ value: item, label: item }))
            }
          />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={stateFilter}
            onChange={setStateFilter}
            placeholder="State"
            loadOptions={async (input) =>
              states
                .filter((item) => item.toLowerCase().includes(input.toLowerCase()))
                .map((item) => ({ value: item, label: item }))
            }
          />
        </div>
        <ActionBar>
          <PermissionGate permission="emergency.request.create">
            <Button onClick={() => navigate('/app/emergency/request')}>Request Resource</Button>
          </PermissionGate>
        </ActionBar>
      </FilterBar>

      {query.isError ? (
        <ErrorState title="Unable to load emergency inventory" description="Retry in a moment." onRetry={() => query.refetch()} />
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
