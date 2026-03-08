import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SmartSelect } from '@/components/data/SmartSelect';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/data/DataTable';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useHealthMetrics, type HealthMetricRow } from '@/api/hooks/useHealthMetrics';

const metrics = [
  { value: 'encounters', label: 'Encounters by State' },
  { value: 'labs', label: 'Labs by Institution' },
  { value: 'prescriptions', label: 'Prescriptions by Provider' },
  { value: 'complaints', label: 'Complaints by State' },
  { value: 'emergencyEvents', label: 'Emergency by Region' },
];

const states = ['Lagos', 'FCT', 'Rivers', 'Kano', 'Kaduna', 'Oyo'];

export function HealthMetricsPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [metric, setMetric] = useState<string | null>('encounters');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [drilldown, setDrilldown] = useState<{ state?: string; metric?: string } | null>(null);

  const query = useHealthMetrics({
    from: from || undefined,
    to: to || undefined,
    state: state || drilldown?.state,
    metric: metric || drilldown?.metric,
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });

  const columns = useMemo<ColumnDef<HealthMetricRow>[]>(
    () => [
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'institution', header: 'Institution' },
      { accessorKey: 'provider', header: 'Provider' },
      { accessorKey: 'encounters', header: 'Encounters' },
      { accessorKey: 'labs', header: 'Labs' },
      { accessorKey: 'prescriptions', header: 'Prescriptions' },
      { accessorKey: 'complaints', header: 'Complaints' },
      { accessorKey: 'emergencyEvents', header: 'Emergency Events' },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDrilldown({ state: row.original.state, metric: metric ?? undefined });
              setPagination((prev) => ({ ...prev, pageIndex: 0 }));
            }}
          >
            Drill-down
          </Button>
        ),
      },
    ],
    [metric],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health System Metrics"
        description="Deep metric views for state and institution-level operational analysis."
        breadcrumbs={[{ label: 'Analytics' }, { label: 'Metrics' }]}
        actions={
          <Button variant="outline" onClick={() => navigate('/app/analytics/dashboard')}>
            Back to Dashboard
          </Button>
        }
      />

      <FilterBar>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="w-full md:max-w-[160px]">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="w-full md:max-w-[220px]">
          <SmartSelect
            value={state}
            onChange={setState}
            placeholder="Filter by state"
            loadOptions={async (input) =>
              states
                .filter((entry) => entry.toLowerCase().includes(input.toLowerCase()))
                .map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[260px]">
          <SmartSelect
            value={metric}
            onChange={setMetric}
            placeholder="Metric view"
            loadOptions={async (input) =>
              metrics
                .filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                .map((entry) => ({ value: entry.value, label: entry.label }))
            }
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setFrom('');
            setTo('');
            setState(null);
            setMetric('encounters');
            setDrilldown(null);
          }}
        >
          Clear
        </Button>
      </FilterBar>

      {drilldown ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Drill-down Active</CardTitle>
              <CardDescription>
                Viewing filtered records for {drilldown.state ?? 'all states'} ({drilldown.metric ?? 'all metrics'}).
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setDrilldown(null)}>
              Reset Drill-down
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      {query.isError ? (
        <ErrorState title="Unable to load health metrics" description="Please retry." onRetry={() => query.refetch()} />
      ) : query.data && query.data.rows.length === 0 && !query.isLoading ? (
        <EmptyState title="No metrics available" description="Try adjusting your filters." />
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
