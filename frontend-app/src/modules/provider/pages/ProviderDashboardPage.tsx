import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { KpiGrid } from '@/components/data/KpiGrid';
import { PageHeader } from '@/components/layout/PageHeader';

export function ProviderDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Workspace"
        description="Clinical operations, patient queues, and institutional insights in one calm workspace."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline">Export queue</Button>
            <Button>Create encounter</Button>
          </>
        }
      />

      <KpiGrid />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Patient flow</CardTitle>
              <CardDescription>Monitor waiting rooms and active triage states across branches.</CardDescription>
            </div>
          </CardHeader>
          <p className="text-sm text-muted">Queue visualizations and branch load widgets will render here.</p>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Clinical alerts</CardTitle>
              <CardDescription>Records requiring attention based on timeline and correction workflows.</CardDescription>
            </div>
          </CardHeader>
          <p className="text-sm text-muted">Rule-based alerts and escalation cards will appear here.</p>
        </Card>
      </div>
    </div>
  );
}
