import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function EmergencyRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Emergency Requests"
        description="Create and monitor scoped emergency alerts, responses, and incident room activity."
        breadcrumbs={[{ label: 'Emergency' }, { label: 'Requests' }]}
        actions={<Button>Create emergency request</Button>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Live requests queue</CardTitle>
              <CardDescription>Critical, high, and medium urgency stream.</CardDescription>
            </div>
          </CardHeader>
          <p className="text-sm text-muted">Real-time queue and map/list toggle go here.</p>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Provider response board</CardTitle>
              <CardDescription>Availability, ETA, and transfer options by org.</CardDescription>
            </div>
          </CardHeader>
          <p className="text-sm text-muted">Response matrix and room activity feed appear here.</p>
        </Card>
      </div>
    </div>
  );
}
