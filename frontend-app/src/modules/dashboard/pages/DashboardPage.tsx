import { KpiGrid } from '@/components/data/KpiGrid';
import { AuditTrailList } from '@/components/data/AuditTrailList';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        description="A unified operational view across NHRS contexts and modules."
        breadcrumbs={[{ label: 'Home' }, { label: 'Dashboard' }]}
      />

      <KpiGrid />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Operational timeline</CardTitle>
              <CardDescription>Recent platform activity, system events, and security traces.</CardDescription>
            </div>
          </CardHeader>
          <AuditTrailList />
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Next actions</CardTitle>
              <CardDescription>Prioritized workflow queue.</CardDescription>
            </div>
          </CardHeader>
          <ul className="space-y-3 text-sm text-muted">
            <li>Review emergency requests awaiting dispatch assignment.</li>
            <li>Approve pending role changes for provider orgs.</li>
            <li>Verify latest doctor registry submissions.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
