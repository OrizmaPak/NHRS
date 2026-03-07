import { useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { DataTable } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/feedback/StatusBadge';

const rows = [
  { caseId: 'CASE-0001', subject: 'Record correction request', status: 'pending' as const, level: 'STATE' },
  { caseId: 'CASE-0002', subject: 'Emergency supply complaint', status: 'active' as const, level: 'LGA' },
  { caseId: 'CASE-0003', subject: 'Provider misconduct report', status: 'suspended' as const, level: 'NATIONAL' },
];

export function ComplaintsPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const columns: ColumnDef<(typeof rows)[number]>[] = [
    { accessorKey: 'caseId', header: 'Case ID' },
    { accessorKey: 'subject', header: 'Subject' },
    { accessorKey: 'level', header: 'Assigned Level' },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints & Case Management"
        description="Track citizen complaints, correction proposals, and inter-level escalations."
        breadcrumbs={[{ label: 'Taskforce' }, { label: 'Cases' }]}
      />
      <DataTable
        columns={columns}
        data={rows}
        total={rows.length}
        pagination={pagination}
        onPaginationChange={setPagination}
        pageCount={1}
      />
    </div>
  );
}
