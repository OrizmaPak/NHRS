import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useComplianceIssues, type ComplianceIssue } from '@/api/hooks/useComplianceIssues';

const severityOptions = ['low', 'medium', 'high', 'critical'];

export function DataQualityPage() {
  const [severity, setSeverity] = useState<string | null>(null);
  const [institution, setInstitution] = useState('');
  const [issueType, setIssueType] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });

  const query = useComplianceIssues({
    severity: severity || undefined,
    institution: institution || undefined,
    issueType: issueType || undefined,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  const columns = useMemo<ColumnDef<ComplianceIssue>[]>(
    () => [
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'issueType', header: 'Issue Type' },
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: ({ row }) => <StatusBadge status={row.original.severity} />,
      },
      { accessorKey: 'recordsAffected', header: 'Records Affected' },
      { accessorKey: 'lastDetected', header: 'Last Detected' },
      {
        id: 'actions',
        header: 'Actions',
        cell: () => <Button size="sm" variant="outline">Open Institution</Button>,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Quality Monitoring"
        description="Track record completeness, delays, and institutional data quality gaps."
        breadcrumbs={[{ label: 'Compliance' }, { label: 'Data Quality' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-[180px]">
          <SmartSelect
            value={severity}
            onChange={setSeverity}
            placeholder="Severity"
            loadOptions={async (input) =>
              severityOptions
                .filter((entry) => entry.includes(input.toLowerCase()))
                .map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[260px]">
          <SearchInput value={institution} onChange={setInstitution} placeholder="Institution" />
        </div>
        <div className="w-full md:max-w-[260px]">
          <SearchInput value={issueType} onChange={setIssueType} placeholder="Issue type" />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setSeverity(null);
            setInstitution('');
            setIssueType('');
          }}
        >
          Clear
        </Button>
      </FilterBar>

      {query.isError ? (
        <ErrorState title="Unable to load data quality issues" description="Please retry." onRetry={() => query.refetch()} />
      ) : query.data && query.data.rows.length === 0 && !query.isLoading ? (
        <EmptyState title="No issues detected" description="Current filters show no active compliance issues." />
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
