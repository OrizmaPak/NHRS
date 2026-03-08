import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useReports, useGenerateReport, useDownloadReport, type ReportItem } from '@/api/hooks/useReports';

export function ReportsPage() {
  const navigate = useNavigate();
  const reportsQuery = useReports();
  const generateReport = useGenerateReport();
  const downloadReport = useDownloadReport();

  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const filteredRows = useMemo(() => {
    const rows = reportsQuery.data ?? [];
    if (!query.trim()) return rows;
    const key = query.toLowerCase();
    return rows.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(key));
  }, [query, reportsQuery.data]);

  const pagedRows = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize;
    return filteredRows.slice(start, start + pagination.pageSize);
  }, [filteredRows, pagination.pageIndex, pagination.pageSize]);

  const columns = useMemo<ColumnDef<ReportItem>[]>(
    () => [
      { accessorKey: 'name', header: 'Report Name' },
      { accessorKey: 'description', header: 'Description' },
      {
        accessorKey: 'lastGeneratedAt',
        header: 'Last Generated',
        cell: ({ row }) => row.original.lastGeneratedAt ?? 'Never',
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <PermissionGate permission="reports.generate">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await generateReport.mutateAsync({
                    reportId: row.original.id,
                    filters: {},
                  });
                }}
              >
                Generate
              </Button>
            </PermissionGate>
            <PermissionGate permission="reports.download">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await downloadReport.mutateAsync({ reportId: row.original.id, format: 'csv' });
                }}
              >
                Download CSV
              </Button>
            </PermissionGate>
            <Button size="sm" onClick={() => navigate(`/app/reports/${row.original.id}`)}>
              Open
            </Button>
          </div>
        ),
      },
    ],
    [downloadReport, generateReport, navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operational Reports"
        description="Generate and export structured national health system reports."
        breadcrumbs={[{ label: 'Reports' }]}
        actions={
          <PermissionGate permission="reports.generate">
            <Button asChild variant="outline">
              <Link to="/app/reports/institution-activity">Quick Generate</Link>
            </Button>
          </PermissionGate>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search report catalog" />
        </div>
      </FilterBar>

      {reportsQuery.isError ? (
        <ErrorState title="Unable to load report catalog" description="Please retry." onRetry={() => reportsQuery.refetch()} />
      ) : filteredRows.length === 0 && !reportsQuery.isLoading ? (
        <EmptyState title="No reports found" description="No report matches your current search." />
      ) : (
        <DataTable
          columns={columns}
          data={pagedRows}
          total={filteredRows.length}
          loading={reportsQuery.isLoading || generateReport.isPending || downloadReport.isPending}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(filteredRows.length / pagination.pageSize))}
        />
      )}
    </div>
  );
}
