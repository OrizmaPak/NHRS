import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ActionBar } from '@/components/data/ActionBar';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Button } from '@/components/ui/Button';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { AssignmentDrawer } from '@/modules/taskforce/components/AssignmentDrawer';
import { EscalateCaseDrawer } from '@/modules/taskforce/components/EscalateCaseDrawer';
import { useCases } from '@/api/hooks/useCases';
import { useAssignCase } from '@/api/hooks/useAssignCase';
import { useEscalateCase } from '@/api/hooks/useEscalateCase';
import type { CaseRow } from '@/api/hooks/taskforceTypes';
import { useContextStore } from '@/stores/contextStore';
import { deriveTaskforceScope } from '@/modules/taskforce/utils/scope';
import { exportRowsToCsv, exportRowsToExcelLike } from '@/lib/export';

const officers = [
  { value: 'officer-1', label: 'Ayo Bello', description: 'State reviewer' },
  { value: 'officer-2', label: 'Ngozi Adamu', description: 'LGA compliance officer' },
  { value: 'officer-3', label: 'Ifeanyi Ude', description: 'National escalation desk' },
];

export function CasesListPage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const scope = deriveTaskforceScope(activeContext);
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [institution, setInstitution] = useState<string | null>(null);
  const [assignedOfficer, setAssignedOfficer] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(scope.state ?? null);
  const [lgaFilter, setLgaFilter] = useState<string | null>(scope.lga ?? null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const [selected, setSelected] = useState<CaseRow | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);

  const casesQuery = useCases({
    q: search || undefined,
    stage: stage || undefined,
    severity: severity || undefined,
    status: status || undefined,
    institution: institution || undefined,
    assignedOfficer: assignedOfficer || undefined,
    state: stateFilter || undefined,
    lga: lgaFilter || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });
  const assignCase = useAssignCase();
  const escalateCase = useEscalateCase();

  const columns = useMemo<ColumnDef<CaseRow>[]>(
    () => [
      { accessorKey: 'caseId', header: 'Case ID' },
      { accessorKey: 'sourceComplaint', header: 'Source Complaint' },
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'lga', header: 'LGA' },
      { accessorKey: 'assignedOfficer', header: 'Assigned Officer' },
      { accessorKey: 'severity', header: 'Severity', cell: ({ row }) => <StatusBadge status={row.original.severity} /> },
      { accessorKey: 'stage', header: 'Stage', cell: ({ row }) => <StatusBadge status={row.original.stage} /> },
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: 'openedAt', header: 'Opened' },
      { accessorKey: 'updatedAt', header: 'Updated' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="Case actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" className="z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-soft">
                <DropdownMenu.Item asChild className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10">
                  <Link to={`/app/taskforce/cases/${row.original.id}`}>View case</Link>
                </DropdownMenu.Item>
                <PermissionGate permission="governance.case.update_status">
                  <DropdownMenu.Item
                    onSelect={() => {
                      setSelected(row.original);
                      setAssignmentOpen(true);
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10"
                  >
                    Assign case
                  </DropdownMenu.Item>
                </PermissionGate>
                <PermissionGate permission="governance.case.escalate">
                  <DropdownMenu.Item
                    onSelect={() => {
                      setSelected(row.original);
                      setEscalateOpen(true);
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10"
                  >
                    Escalate case
                  </DropdownMenu.Item>
                </PermissionGate>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Management"
        description={`Formal enforcement and investigation cases for ${scope.label} scope.`}
        breadcrumbs={[{ label: 'Taskforce' }, { label: 'Cases' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => exportRowsToCsv('cases', (casesQuery.data?.rows ?? []) as Array<Record<string, unknown>>)}
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => exportRowsToExcelLike('cases', (casesQuery.data?.rows ?? []) as Array<Record<string, unknown>>)}
            >
              Export Excel
            </Button>
          </div>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search case or complaint ID" />
        </div>
        <div className="w-full md:max-w-[160px]">
          <SmartSelect
            value={stage}
            onChange={setStage}
            placeholder="Stage"
            loadOptions={async () => [
              { value: 'intake', label: 'Intake' },
              { value: 'in_review', label: 'In review' },
              { value: 'awaiting_approval', label: 'Awaiting approval' },
              { value: 'resolved', label: 'Resolved' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[160px]">
          <SmartSelect
            value={severity}
            onChange={setSeverity}
            placeholder="Severity"
            loadOptions={async () => [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[160px]">
          <SmartSelect
            value={status}
            onChange={setStatus}
            placeholder="Status"
            loadOptions={async () => [
              { value: 'open', label: 'Open' },
              { value: 'in_review', label: 'In review' },
              { value: 'escalated', label: 'Escalated' },
              { value: 'resolved', label: 'Resolved' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[180px]">
          <SearchInput value={institution ?? ''} onChange={(value) => setInstitution(value || null)} placeholder="Institution" />
        </div>
        <div className="w-full md:max-w-[180px]">
          <SearchInput
            value={assignedOfficer ?? ''}
            onChange={(value) => setAssignedOfficer(value || null)}
            placeholder="Assigned officer"
          />
        </div>
        {scope.level !== 'LGA' ? (
          <div className="w-full md:max-w-[170px]">
            <SearchInput value={stateFilter ?? ''} onChange={(value) => setStateFilter(value || null)} placeholder="State" />
          </div>
        ) : null}
        {scope.level === 'NATIONAL' ? (
          <div className="w-full md:max-w-[170px]">
            <SearchInput value={lgaFilter ?? ''} onChange={(value) => setLgaFilter(value || null)} placeholder="LGA" />
          </div>
        ) : null}
        <ActionBar>
          <PermissionGate permission="governance.case.read">
            <Button asChild variant="outline">
              <Link to="/app/taskforce/complaints">Open Complaints</Link>
            </Button>
          </PermissionGate>
        </ActionBar>
      </FilterBar>

      {casesQuery.isError ? (
        <ErrorState title="Unable to load cases" description="Please retry shortly." onRetry={() => casesQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={casesQuery.data?.rows ?? []}
          total={casesQuery.data?.total ?? 0}
          loading={casesQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((casesQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}

      <AssignmentDrawer
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        targetLabel="Case"
        officers={officers}
        onSubmit={async (values) => {
          if (!selected) return;
          await assignCase.mutateAsync({
            caseId: selected.id,
            assigneeId: values.assigneeId,
            dueDate: values.dueDate,
            priority: values.priority,
            comment: values.comment,
          });
        }}
      />

      <EscalateCaseDrawer
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        onSubmit={async (values) => {
          if (!selected) return;
          await escalateCase.mutateAsync({
            caseId: selected.id,
            targetLevel: values.targetLevel,
            targetUnit: values.targetUnit,
            reason: values.reason,
            priority: values.priority,
            notes: values.notes,
          });
        }}
      />
    </div>
  );
}
