import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useReportDetails, useGenerateReport, useDownloadReport } from '@/api/hooks/useReports';

export function ReportDetailsPage() {
  const { reportId = '' } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState('');
  const [institution, setInstitution] = useState('');

  const filters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      state: state || undefined,
      institution: institution || undefined,
    }),
    [from, institution, state, to],
  );

  const detailsQuery = useReportDetails(reportId, filters);
  const generateReport = useGenerateReport();
  const downloadReport = useDownloadReport();

  const rows = detailsQuery.data?.rows ?? [];
  const columns = detailsQuery.data?.columns ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={detailsQuery.data?.name ?? 'Report Details'}
        description={detailsQuery.data?.description || 'Configure filters, generate, and export report output.'}
        breadcrumbs={[{ label: 'Reports' }, { label: reportId }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <PermissionGate permission="reports.generate">
              <Button
                variant="outline"
                onClick={async () => {
                  await generateReport.mutateAsync({ reportId, filters });
                }}
              >
                Generate
              </Button>
            </PermissionGate>
            <PermissionGate permission="reports.download">
              <Button
                variant="outline"
                onClick={async () => {
                  await downloadReport.mutateAsync({ reportId, format: 'excel' });
                }}
              >
                Download Excel
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="w-full md:max-w-[200px]">
          <Input value={state} onChange={(event) => setState(event.target.value)} placeholder="State" />
        </div>
        <div className="w-full md:max-w-[240px]">
          <Input value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder="Institution" />
        </div>
      </FilterBar>

      {detailsQuery.isLoading ? <LoadingSkeleton className="h-80 w-full" /> : null}
      {detailsQuery.isError ? (
        <ErrorState title="Unable to load report details" description="Please retry." onRetry={() => detailsQuery.refetch()} />
      ) : null}

      {!detailsQuery.isLoading && !detailsQuery.isError ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Report Preview</CardTitle>
              <CardDescription>
                {rows.length} rows · {columns.length} columns
              </CardDescription>
            </div>
          </CardHeader>
          {rows.length === 0 ? (
            <EmptyState title="No data for selected filters" description="Generate report after adjusting filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/5">
                  <tr>
                    {columns.map((column) => (
                      <th key={column} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 100).map((row, index) => (
                    <tr key={index}>
                      {columns.map((column) => (
                        <td key={`${index}-${column}`} className="px-4 py-3 text-sm text-foreground">
                          {String(row[column] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
