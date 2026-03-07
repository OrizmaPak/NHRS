import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
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
import { EscalateComplaintDrawer } from '@/modules/taskforce/components/EscalateComplaintDrawer';
import { useComplaints, type ComplaintsParams } from '@/api/hooks/useComplaints';
import { useAssignComplaint } from '@/api/hooks/useAssignComplaint';
import { useEscalateComplaint } from '@/api/hooks/useEscalateComplaint';
import { useCreateCaseFromComplaint } from '@/api/hooks/useCreateCaseFromComplaint';
import type { ComplaintRow } from '@/api/hooks/taskforceTypes';
import { useContextStore } from '@/stores/contextStore';
import { deriveTaskforceScope } from '@/modules/taskforce/utils/scope';

const officers = [
  { value: 'officer-1', label: 'Ayo Bello', description: 'State reviewer' },
  { value: 'officer-2', label: 'Ngozi Adamu', description: 'LGA compliance officer' },
  { value: 'officer-3', label: 'Ifeanyi Ude', description: 'National escalation desk' },
];

export function ComplaintsListPage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const scope = deriveTaskforceScope(activeContext);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [institution, setInstitution] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(scope.state ?? null);
  const [lgaFilter, setLgaFilter] = useState<string | null>(scope.lga ?? null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const [selected, setSelected] = useState<ComplaintRow | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);

  const params: ComplaintsParams = {
    q: search || undefined,
    status: status || undefined,
    priority: priority || undefined,
    institution: institution || undefined,
    state: stateFilter || undefined,
    lga: lgaFilter || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  };

  const complaintsQuery = useComplaints(params);
  const assignComplaint = useAssignComplaint();
  const escalateComplaint = useEscalateComplaint();
  const createCaseFromComplaint = useCreateCaseFromComplaint();

  const columns = useMemo<ColumnDef<ComplaintRow>[]>(
    () => [
      { accessorKey: 'complaintId', header: 'Complaint ID' },
      {
        accessorKey: 'complainant',
        header: 'Complainant',
        cell: ({ row }) => row.original.anonymous ? 'Anonymous' : row.original.complainant,
      },
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'provider', header: 'Provider' },
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'lga', header: 'LGA' },
      { accessorKey: 'complaintType', header: 'Type' },
      { accessorKey: 'priority', header: 'Priority', cell: ({ row }) => <StatusBadge status={row.original.priority} /> },
      { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: 'createdAt', header: 'Created' },
      { accessorKey: 'assignedTo', header: 'Assigned To' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open complaint actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" className="z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-soft">
                <DropdownMenu.Item asChild className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10">
                  <Link to={`/app/taskforce/complaints/${row.original.id}`}>View complaint</Link>
                </DropdownMenu.Item>
                <PermissionGate permission="complaints.assign">
                  <DropdownMenu.Item
                    onSelect={() => {
                      setSelected(row.original);
                      setAssignmentOpen(true);
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10"
                  >
                    Assign complaint
                  </DropdownMenu.Item>
                </PermissionGate>
                <PermissionGate permission="complaints.escalate">
                  <DropdownMenu.Item
                    onSelect={() => {
                      setSelected(row.original);
                      setEscalateOpen(true);
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10"
                  >
                    Escalate complaint
                  </DropdownMenu.Item>
                </PermissionGate>
                <PermissionGate permission="complaints.resolve">
                  <DropdownMenu.Item
                    onSelect={async () => {
                      await assignComplaint.mutateAsync({
                        complaintId: row.original.id,
                        assigneeId: row.original.assignedTo,
                        priority: 'low',
                        comment: 'Marked as in review/resolved by operations desk',
                      });
                      toast.success('Complaint updated');
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10"
                  >
                    Mark in review
                  </DropdownMenu.Item>
                </PermissionGate>
                <PermissionGate permission="cases.create">
                  <DropdownMenu.Item
                    onSelect={async () => {
                      await createCaseFromComplaint.mutateAsync(row.original.id);
                      toast.success('Case created from complaint');
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none focus:bg-primary/10"
                  >
                    Convert to case
                  </DropdownMenu.Item>
                </PermissionGate>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ),
      },
    ],
    [assignComplaint, createCaseFromComplaint],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints Triage"
        description={`Complaint intake and triage for ${scope.label} jurisdiction.`}
        breadcrumbs={[{ label: 'Taskforce' }, { label: 'Complaints' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Search ID, institution, provider" />
        </div>
        <div className="w-full md:max-w-[180px]">
          <SmartSelect
            value={status}
            onChange={setStatus}
            placeholder="Status"
            loadOptions={async () => [
              { value: 'open', label: 'Open' },
              { value: 'in_review', label: 'In review' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'escalated', label: 'Escalated' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[170px]">
          <SmartSelect
            value={priority}
            onChange={setPriority}
            placeholder="Priority"
            loadOptions={async () => [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'critical', label: 'Critical' },
            ]}
          />
        </div>
        <div className="w-full md:max-w-[220px]">
          <SearchInput value={institution ?? ''} onChange={(value) => setInstitution(value || null)} placeholder="Institution" />
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
          <PermissionGate permission="cases.create">
            <Button asChild variant="outline">
              <Link to="/app/taskforce/cases">Open Cases</Link>
            </Button>
          </PermissionGate>
        </ActionBar>
      </FilterBar>

      {complaintsQuery.isError ? (
        <ErrorState title="Unable to load complaints" description="Please retry shortly." onRetry={() => complaintsQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={complaintsQuery.data?.rows ?? []}
          total={complaintsQuery.data?.total ?? 0}
          loading={complaintsQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((complaintsQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}

      <AssignmentDrawer
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        targetLabel="Complaint"
        officers={officers}
        onSubmit={async (values) => {
          if (!selected) return;
          await assignComplaint.mutateAsync({
            complaintId: selected.id,
            assigneeId: values.assigneeId,
            dueDate: values.dueDate,
            priority: values.priority,
            comment: values.comment,
          });
        }}
      />

      <EscalateComplaintDrawer
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        onSubmit={async (values) => {
          if (!selected) return;
          await escalateComplaint.mutateAsync({
            complaintId: selected.id,
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
