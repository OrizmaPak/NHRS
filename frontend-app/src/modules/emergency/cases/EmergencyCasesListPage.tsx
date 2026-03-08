import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { ActionBar } from '@/components/data/ActionBar';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useEmergencyCases, useUpdateEmergencyCaseStatus, type EmergencyCase } from '@/api/hooks/useEmergencyCases';
import { AssignResponderDrawer } from '@/modules/emergency/components/AssignResponderDrawer';
import { UpdateEmergencyStatusDrawer } from '@/modules/emergency/components/UpdateEmergencyStatusDrawer';
import { toast } from 'sonner';

const incidentTypes = ['mass_casualty', 'disaster_response', 'urgent_transfer', 'national_alert'];
const priorities = ['critical', 'high', 'medium', 'low'];
const statuses = ['open', 'in_progress', 'resolved', 'cancelled'];

export function EmergencyCasesListPage() {
  const navigate = useNavigate();
  const [incidentType, setIncidentType] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState('');
  const [lga, setLga] = useState('');
  const [institution, setInstitution] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [selectedCase, setSelectedCase] = useState<EmergencyCase | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const updateStatus = useUpdateEmergencyCaseStatus();

  const query = useEmergencyCases({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    incidentType: incidentType || undefined,
    priority: priority || undefined,
    status: status || undefined,
    state: stateFilter || undefined,
    lga: lga || undefined,
    institution: institution || undefined,
  });

  const columns = useMemo<ColumnDef<EmergencyCase>[]>(
    () => [
      { accessorKey: 'caseId', header: 'Case ID' },
      { accessorKey: 'incidentType', header: 'Incident Type' },
      {
        id: 'location',
        header: 'Location',
        cell: ({ row }) => `${row.original.state} / ${row.original.lga}`,
      },
      { accessorKey: 'institution', header: 'Institution' },
      {
        accessorKey: 'priority',
        header: 'Priority',
        cell: ({ row }) => <StatusBadge status={row.original.priority} />,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      { accessorKey: 'assignedResponder', header: 'Assigned Responder' },
      { accessorKey: 'createdAt', header: 'Created' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/app/emergency/cases/${row.original.id}`)}>
              View
            </Button>
            <PermissionGate permission="emergency.dispatch">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedCase(row.original);
                  setAssignOpen(true);
                }}
              >
                Assign
              </Button>
            </PermissionGate>
            <PermissionGate permission="emergency.dispatch">
              <Button size="sm" onClick={() => navigate(`/app/emergency/cases/${row.original.id}`)}>
                Dispatch
              </Button>
            </PermissionGate>
            <PermissionGate permission="emergency.dispatch">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedCase(row.original);
                  setStatusOpen(true);
                }}
              >
                Update Status
              </Button>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emergency Cases"
        description="Coordinate urgent incidents, assign responders, and dispatch resources."
        breadcrumbs={[{ label: 'Emergency' }, { label: 'Cases' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={incidentType}
            onChange={setIncidentType}
            placeholder="Incident type"
            loadOptions={async (input) =>
              incidentTypes
                .filter((option) => option.includes(input.toLowerCase()))
                .map((option) => ({ value: option, label: option.replace('_', ' ') }))
            }
          />
        </div>
        <div className="w-full md:max-w-[170px]">
          <SmartSelect
            value={priority}
            onChange={setPriority}
            placeholder="Priority"
            loadOptions={async (input) =>
              priorities
                .filter((option) => option.includes(input.toLowerCase()))
                .map((option) => ({ value: option, label: option }))
            }
          />
        </div>
        <div className="w-full md:max-w-[170px]">
          <SmartSelect
            value={status}
            onChange={setStatus}
            placeholder="Status"
            loadOptions={async (input) =>
              statuses
                .filter((option) => option.includes(input.toLowerCase()))
                .map((option) => ({ value: option, label: option }))
            }
          />
        </div>
        <div className="w-full md:max-w-[180px]">
          <Input value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} placeholder="State" />
        </div>
        <div className="w-full md:max-w-[180px]">
          <Input value={lga} onChange={(event) => setLga(event.target.value)} placeholder="LGA" />
        </div>
        <div className="w-full md:max-w-[220px]">
          <Input value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder="Institution" />
        </div>
        <ActionBar>
          <Button
            variant="outline"
            onClick={() => {
              setIncidentType(null);
              setPriority(null);
              setStatus(null);
              setStateFilter('');
              setLga('');
              setInstitution('');
            }}
          >
            Clear
          </Button>
        </ActionBar>
      </FilterBar>

      {query.isError ? (
        <ErrorState title="Unable to load emergency cases" description="Retry in a moment." onRetry={() => query.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={query.data?.rows ?? []}
            total={query.data?.total ?? 0}
            loading={query.isLoading}
            pagination={pagination}
            onPaginationChange={setPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / pagination.pageSize))}
          />
          <AssignResponderDrawer
            open={assignOpen}
            onOpenChange={setAssignOpen}
            onSubmit={async (values) => {
              if (!selectedCase) return;
              await updateStatus.mutateAsync({
                caseId: selectedCase.id,
                status: 'in_progress',
                reason: values.note,
                assignedResponder: values.responder,
              });
              toast.success('Responder assigned');
            }}
          />
          <UpdateEmergencyStatusDrawer
            open={statusOpen}
            onOpenChange={setStatusOpen}
            onSubmit={async (values) => {
              if (!selectedCase) return;
              await updateStatus.mutateAsync({
                caseId: selectedCase.id,
                status: values.status,
                reason: values.reason,
              });
              toast.success('Emergency case status updated');
            }}
          />
        </>
      )}
    </div>
  );
}

