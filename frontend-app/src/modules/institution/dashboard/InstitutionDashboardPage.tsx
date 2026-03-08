import { Link } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useInstitutionDashboard, type InstitutionDashboardData } from '@/api/hooks/useInstitutionDashboard';

export function InstitutionDashboardPage() {
  const query = useInstitutionDashboard();
  const [encounterPagination, setEncounterPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 5 });
  const [labPagination, setLabPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 5 });
  const [pharmPagination, setPharmPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 5 });

  type EncounterItem = InstitutionDashboardData['recentEncounters'][number];
  type LabItem = InstitutionDashboardData['pendingLabResults'][number];
  type PrescriptionItem = InstitutionDashboardData['pendingPrescriptionQueue'][number];

  const encounterColumns = useMemo<ColumnDef<EncounterItem>[]>(
    () => [
      { accessorKey: 'id', header: 'Encounter ID' },
      { accessorKey: 'patient', header: 'Patient' },
      { accessorKey: 'clinician', header: 'Clinician' },
      { accessorKey: 'date', header: 'Date' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [query.data?.recentEncounters],
  );

  const labColumns = useMemo<ColumnDef<LabItem>[]>(
    () => [
      { accessorKey: 'id', header: 'Lab ID' },
      { accessorKey: 'patient', header: 'Patient' },
      { accessorKey: 'testType', header: 'Test Type' },
      { accessorKey: 'requestedDate', header: 'Requested' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [query.data?.pendingLabResults],
  );

  const prescriptionColumns = useMemo<ColumnDef<PrescriptionItem>[]>(
    () => [
      { accessorKey: 'id', header: 'Prescription ID' },
      { accessorKey: 'patient', header: 'Patient' },
      { accessorKey: 'medication', header: 'Medication' },
      { accessorKey: 'date', header: 'Date' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [query.data?.pendingPrescriptionQueue],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institution Dashboard"
        description="Operational command center for daily hospital and clinic execution."
        breadcrumbs={[{ label: 'Institution' }, { label: 'Dashboard' }]}
      />

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <LoadingSkeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState title="Unable to load institution dashboard" description="Please retry." onRetry={() => query.refetch()} />
      ) : null}

      {query.data ? (
        <>
          <KpiGrid>
            <StatCard label="Patients Today" value={String(query.data.patientsToday)} delta="Current operational day" trend="up" />
            <StatCard label="Pending Labs" value={String(query.data.pendingLabs)} delta="Awaiting completion" trend={query.data.pendingLabs > 0 ? 'up' : 'down'} />
            <StatCard label="Pending Prescriptions" value={String(query.data.pendingPrescriptions)} delta="Dispense queue" trend={query.data.pendingPrescriptions > 0 ? 'up' : 'down'} />
            <StatCard label="Active Emergency Alerts" value={String(query.data.activeEmergencyAlerts)} delta="Requires coordination" trend={query.data.activeEmergencyAlerts > 0 ? 'up' : 'down'} />
            <StatCard label="Compliance Status" value={query.data.complianceStatus} delta="Governance posture" trend="down" />
          </KpiGrid>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Direct access to core clinical workflows.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <PermissionGate permission="encounters.create">
                  <Button asChild variant="outline"><Link to="/app/provider/encounters/new">Create Encounter</Link></Button>
                </PermissionGate>
                <PermissionGate permission="labs.create">
                  <Button asChild variant="outline"><Link to="/app/provider/labs/new">Create Lab Request</Link></Button>
                </PermissionGate>
                <PermissionGate permission="pharmacy.create">
                  <Button asChild variant="outline"><Link to="/app/provider/pharmacy/new">Create Prescription</Link></Button>
                </PermissionGate>
              </div>
            </CardHeader>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Recent Encounters</CardTitle></CardHeader>
              <DataTable
                columns={encounterColumns}
                data={query.data.recentEncounters}
                total={query.data.recentEncounters.length}
                loading={query.isLoading}
                pagination={encounterPagination}
                onPaginationChange={setEncounterPagination}
                pageCount={Math.max(1, Math.ceil((query.data.recentEncounters.length || 0) / encounterPagination.pageSize))}
              />
            </Card>

            <Card>
              <CardHeader><CardTitle>Pending Lab Results</CardTitle></CardHeader>
              <DataTable
                columns={labColumns}
                data={query.data.pendingLabResults}
                total={query.data.pendingLabResults.length}
                loading={query.isLoading}
                pagination={labPagination}
                onPaginationChange={setLabPagination}
                pageCount={Math.max(1, Math.ceil((query.data.pendingLabResults.length || 0) / labPagination.pageSize))}
              />
            </Card>

            <Card>
              <CardHeader><CardTitle>Pending Prescriptions</CardTitle></CardHeader>
              <DataTable
                columns={prescriptionColumns}
                data={query.data.pendingPrescriptionQueue}
                total={query.data.pendingPrescriptionQueue.length}
                loading={query.isLoading}
                pagination={pharmPagination}
                onPaginationChange={setPharmPagination}
                pageCount={Math.max(1, Math.ceil((query.data.pendingPrescriptionQueue.length || 0) / pharmPagination.pageSize))}
              />
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

