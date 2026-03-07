import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';

export function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Government Analytics"
        description="Public health metrics, trend monitoring, and policy intelligence dashboards."
        breadcrumbs={[{ label: 'Analytics' }]}
      />
      <Card>
        <p className="text-sm text-muted">Analytics widgets and chart tiles will be implemented per module permissions.</p>
      </Card>
    </div>
  );
}
