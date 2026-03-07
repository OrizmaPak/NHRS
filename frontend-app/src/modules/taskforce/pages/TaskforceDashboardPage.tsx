import { KpiGrid } from '@/components/data/KpiGrid';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

export function TaskforceDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Taskforce Operations"
        description="State and LGA coordination, case routing, and correction approvals."
        breadcrumbs={[{ label: 'Taskforce' }, { label: 'Dashboard' }]}
      />

      <KpiGrid />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Escalation heatmap</CardTitle>
            <CardDescription>Case severity by jurisdiction and active assignees.</CardDescription>
          </div>
        </CardHeader>
        <p className="text-sm text-muted">Map and escalation timeline widgets plug into this area.</p>
      </Card>
    </div>
  );
}
