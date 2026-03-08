import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useAuditEvents } from '@/api/hooks/useAuditEvents';
import type { AuditEventRow } from '@/api/hooks/taskforceTypes';
import { Input } from '@/components/ui/Input';
import { exportRowsToCsv, exportRowsToExcelLike } from '@/lib/export';

export function AuditPage() {
  const [actor, setActor] = useState('');
  const [actorType, setActorType] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [institution, setInstitution] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });

  const auditQuery = useAuditEvents({
    actor: actor || undefined,
    actorType: actorType || undefined,
    module: moduleFilter || undefined,
    action: actionFilter || undefined,
    institution: institution || undefined,
    state: stateFilter || undefined,
    from: from || undefined,
    to: to || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  const columns = useMemo<ColumnDef<AuditEventRow>[]>(
    () => [
      { accessorKey: 'eventId', header: 'Event ID' },
      { accessorKey: 'actor', header: 'Actor' },
      { accessorKey: 'actorType', header: 'Actor Type' },
      { accessorKey: 'actorRole', header: 'Role' },
      { accessorKey: 'action', header: 'Action' },
      { accessorKey: 'module', header: 'Module' },
      { accessorKey: 'targetType', header: 'Target Type' },
      { accessorKey: 'targetId', header: 'Target ID' },
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'outcome', header: 'Outcome' },
      { accessorKey: 'summary', header: 'Before/After Summary' },
      { accessorKey: 'timestamp', header: 'Timestamp' },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance Audit Trail"
        description="Global audit search with actor, module, action, and timeline filters."
        breadcrumbs={[{ label: 'Governance' }, { label: 'Audit' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => exportRowsToCsv('audit-events', (auditQuery.data?.rows ?? []) as Array<Record<string, unknown>>)}
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => exportRowsToExcelLike('audit-events', (auditQuery.data?.rows ?? []) as Array<Record<string, unknown>>)}
            >
              Export Excel
            </Button>
          </div>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={actor} onChange={setActor} placeholder="Filter by actor" />
        </div>
        <div className="w-full md:max-w-[170px]">
          <SmartSelect
            value={actorType}
            onChange={setActorType}
            placeholder="Actor Type"
            loadOptions={async () => [
              { value: 'user', label: 'User' },
              { value: 'service', label: 'Service' },
              { value: 'system', label: 'System' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[170px]">
          <SmartSelect
            value={moduleFilter}
            onChange={setModuleFilter}
            placeholder="Module"
            loadOptions={async () => [
              { value: 'auth', label: 'Auth' },
              { value: 'rbac', label: 'RBAC' },
              { value: 'cases', label: 'Cases' },
              { value: 'records', label: 'Records' },
              { value: 'emergency', label: 'Emergency' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[190px]">
          <SmartSelect
            value={actionFilter}
            onChange={setActionFilter}
            placeholder="Action"
            loadOptions={async () => [
              { value: 'create', label: 'Create' },
              { value: 'update', label: 'Update' },
              { value: 'delete', label: 'Delete' },
              { value: 'read', label: 'Read' },
              { value: 'escalate', label: 'Escalate' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[200px]">
          <SearchInput value={institution} onChange={setInstitution} placeholder="Institution" />
        </div>
        <div className="w-full md:max-w-[150px]">
          <SearchInput value={stateFilter} onChange={setStateFilter} placeholder="State" />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setActor('');
            setActorType(null);
            setModuleFilter(null);
            setActionFilter(null);
            setInstitution('');
            setStateFilter('');
            setFrom('');
            setTo('');
          }}
        >
          Clear
        </Button>
      </FilterBar>

      {auditQuery.isError ? (
        <ErrorState title="Unable to load audit events" description="Please retry shortly." onRetry={() => auditQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={auditQuery.data?.rows ?? []}
          total={auditQuery.data?.total ?? 0}
          loading={auditQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((auditQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}
    </div>
  );
}
