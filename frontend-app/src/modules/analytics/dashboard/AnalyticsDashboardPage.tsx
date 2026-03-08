import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SmartSelect } from '@/components/data/SmartSelect';
import { Input } from '@/components/ui/Input';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/Button';
import { useAnalyticsDashboard } from '@/api/hooks/useAnalyticsDashboard';
import { exportRowsToCsv, exportRowsToExcelLike } from '@/lib/export';

const states = ['Lagos', 'FCT', 'Rivers', 'Kano', 'Kaduna'];
const institutionTypes = ['hospital', 'laboratory', 'pharmacy', 'government'];
const pieColors = ['#0f766e', '#1d4ed8', '#16a34a', '#b45309', '#7e22ce'];

export function AnalyticsDashboardPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [institutionType, setInstitutionType] = useState<string | null>(null);

  const query = useAnalyticsDashboard({
    from: from || undefined,
    to: to || undefined,
    state: state || undefined,
    institutionType: institutionType || undefined,
  });

  const timelineData = useMemo(() => {
    const encounters = query.data?.encountersPerDay ?? [];
    const labs = query.data?.labRequestsPerDay ?? [];
    const prescriptions = query.data?.prescriptionsDispensed ?? [];
    const byDate = new Map<string, { date: string; encounters: number; labs: number; prescriptions: number }>();

    encounters.forEach((item) => byDate.set(item.date, { date: item.date, encounters: item.value, labs: 0, prescriptions: 0 }));
    labs.forEach((item) => {
      const current = byDate.get(item.date) ?? { date: item.date, encounters: 0, labs: 0, prescriptions: 0 };
      current.labs = item.value;
      byDate.set(item.date, current);
    });
    prescriptions.forEach((item) => {
      const current = byDate.get(item.date) ?? { date: item.date, encounters: 0, labs: 0, prescriptions: 0 };
      current.prescriptions = item.value;
      byDate.set(item.date, current);
    });

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [query.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="National Analytics Dashboard"
        description="National and regional operational analytics for health system leadership."
        breadcrumbs={[{ label: 'Analytics' }, { label: 'Dashboard' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                exportRowsToCsv(
                  'analytics-throughput',
                  (timelineData as Array<Record<string, unknown>>).map((entry) => ({
                    date: entry.date,
                    encounters: entry.encounters,
                    labs: entry.labs,
                    prescriptions: entry.prescriptions,
                  })),
                )
              }
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                exportRowsToExcelLike(
                  'analytics-throughput',
                  (timelineData as Array<Record<string, unknown>>).map((entry) => ({
                    date: entry.date,
                    encounters: entry.encounters,
                    labs: entry.labs,
                    prescriptions: entry.prescriptions,
                  })),
                )
              }
            >
              Export Excel
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/analytics/metrics">Open Metrics</Link>
            </Button>
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
          <SmartSelect
            value={state}
            onChange={setState}
            placeholder="State"
            loadOptions={async (input) =>
              states.filter((entry) => entry.toLowerCase().includes(input.toLowerCase())).map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
        <div className="w-full md:max-w-[220px]">
          <SmartSelect
            value={institutionType}
            onChange={setInstitutionType}
            placeholder="Institution type"
            loadOptions={async (input) =>
              institutionTypes
                .filter((entry) => entry.toLowerCase().includes(input.toLowerCase()))
                .map((entry) => ({ value: entry, label: entry }))
            }
          />
        </div>
      </FilterBar>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LoadingSkeleton className="h-44 w-full" />
          <LoadingSkeleton className="h-44 w-full" />
        </div>
      ) : null}
      {query.isError ? <ErrorState title="Unable to load analytics" description="Please retry." onRetry={() => query.refetch()} /> : null}

      {!query.isLoading && !query.isError && query.data ? (
        <>
          <KpiGrid>
            <StatCard label="Patients Registered" value={String(query.data.patientsRegistered)} delta="Current filter range" trend={query.data.patientsRegistered > 0 ? 'up' : 'down'} />
            <StatCard label="Active Complaints" value={String(query.data.activeComplaints)} delta="Governance pressure" trend={query.data.activeComplaints > 0 ? 'up' : 'down'} />
            <StatCard label="Emergency Incidents" value={String(query.data.emergencyIncidents)} delta="Response load" trend={query.data.emergencyIncidents > 0 ? 'up' : 'down'} />
            <StatCard label="Case Escalations" value={String(query.data.caseEscalations)} delta="Escalation volume" trend={query.data.caseEscalations > 0 ? 'up' : 'down'} />
          </KpiGrid>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Service Trends</CardTitle>
                  <CardDescription>Encounters, labs, and prescriptions over time.</CardDescription>
                </div>
              </CardHeader>
              <div className="h-80">
                {timelineData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timelineData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="encounters" stroke="#1d4ed8" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="labs" stroke="#0f766e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="prescriptions" stroke="#b45309" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No trend data" description="No records found for current filters." />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Institution Type Breakdown</CardTitle>
                  <CardDescription>Distribution by institution type.</CardDescription>
                </div>
              </CardHeader>
              <div className="h-80">
                {(query.data.institutionTypeBreakdown ?? []).length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={query.data.institutionTypeBreakdown} dataKey="value" nameKey="name" outerRadius={110} label>
                        {query.data.institutionTypeBreakdown.map((entry, index) => (
                          <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState title="No distribution data" description="Institution breakdown will appear here." />
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Operational Throughput</CardTitle>
                <CardDescription>Quick comparison of encounters, labs, and prescriptions totals.</CardDescription>
              </div>
            </CardHeader>
            <div className="h-72">
              {timelineData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineData.slice(-14)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="encounters" fill="#1d4ed8" />
                    <Bar dataKey="labs" fill="#0f766e" />
                    <Bar dataKey="prescriptions" fill="#b45309" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState title="No throughput data" description="No data for current range." />
              )}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
