import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useComplianceSummary } from '@/api/hooks/useComplianceSummary';

type ViolationRow = {
  id: string;
  institution: string;
  status: string;
  severity: string;
};

type OverdueComplaintRow = {
  id: string;
  complaintId: string;
  institution: string;
  overdueByDays: number;
};

type UnresolvedCaseRow = {
  id: string;
  caseId: string;
  institution: string;
  stage: string;
};

export function ComplianceDashboardPage() {
  const query = useComplianceSummary();

  const [violPagination, setViolPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [complaintPagination, setComplaintPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [casePagination, setCasePagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });

  const violationColumns = useMemo<ColumnDef<ViolationRow>[]>(
    () => [
      { accessorKey: 'institution', header: 'Institution' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: ({ row }) => <StatusBadge status={row.original.severity} />,
      },
      { id: 'actions', header: 'Actions', cell: () => <Button size="sm" variant="outline">Drill-down</Button> },
    ],
    [],
  );

  const complaintColumns = useMemo<ColumnDef<OverdueComplaintRow>[]>(
    () => [
      { accessorKey: 'complaintId', header: 'Complaint ID' },
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'overdueByDays', header: 'Overdue (days)' },
      { id: 'actions', header: 'Actions', cell: () => <Button size="sm" variant="outline">Open</Button> },
    ],
    [],
  );

  const caseColumns = useMemo<ColumnDef<UnresolvedCaseRow>[]>(
    () => [
      { accessorKey: 'caseId', header: 'Case ID' },
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'stage', header: 'Stage' },
      { id: 'actions', header: 'Actions', cell: () => <Button size="sm" variant="outline">Open</Button> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Dashboard"
        description="Regulatory compliance posture across institutions, complaints, and cases."
        breadcrumbs={[{ label: 'Compliance' }, { label: 'Dashboard' }]}
      />

      {query.isError ? (
        <ErrorState title="Unable to load compliance summary" description="Please retry." onRetry={() => query.refetch()} />
      ) : null}

      <KpiGrid>
        <StatCard label="Institutions Compliant" value={String(query.data?.institutionsCompliant ?? 0)} delta="Current cycle" trend="up" />
        <StatCard label="Under Warning" value={String(query.data?.institutionsWarning ?? 0)} delta="Needs intervention" trend={(query.data?.institutionsWarning ?? 0) > 0 ? 'up' : 'down'} />
        <StatCard label="Under Review" value={String(query.data?.institutionsUnderReview ?? 0)} delta="Active investigations" trend={(query.data?.institutionsUnderReview ?? 0) > 0 ? 'up' : 'down'} />
        <StatCard label="Compliance Score" value={`${query.data?.complianceScore ?? 0}%`} delta="Weighted score" trend={(query.data?.complianceScore ?? 0) >= 70 ? 'up' : 'down'} />
      </KpiGrid>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Institutions with Violations</CardTitle>
              <CardDescription>Institutions currently flagged for compliance breaches.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={violationColumns}
            data={query.data?.institutionsWithViolations ?? []}
            total={query.data?.institutionsWithViolations.length ?? 0}
            loading={query.isLoading}
            pagination={violPagination}
            onPaginationChange={setViolPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.institutionsWithViolations.length ?? 0) / violPagination.pageSize))}
          />
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Overdue Complaints</CardTitle>
              <CardDescription>High-priority complaints pending beyond SLA.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={complaintColumns}
            data={query.data?.overdueComplaints ?? []}
            total={query.data?.overdueComplaints.length ?? 0}
            loading={query.isLoading}
            pagination={complaintPagination}
            onPaginationChange={setComplaintPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.overdueComplaints.length ?? 0) / complaintPagination.pageSize))}
          />
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Unresolved Cases</CardTitle>
              <CardDescription>Cases still open across enforcement stages.</CardDescription>
            </div>
          </CardHeader>
          <DataTable
            columns={caseColumns}
            data={query.data?.unresolvedCases ?? []}
            total={query.data?.unresolvedCases.length ?? 0}
            loading={query.isLoading}
            pagination={casePagination}
            onPaginationChange={setCasePagination}
            pageCount={Math.max(1, Math.ceil((query.data?.unresolvedCases.length ?? 0) / casePagination.pageSize))}
          />
        </Card>
      </div>
    </div>
  );
}
