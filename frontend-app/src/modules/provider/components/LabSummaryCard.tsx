import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';

type Props = {
  labRequestId: string;
  testType: string;
  urgency: string;
  facility: string;
  provider: string;
  status: string;
};

export function LabSummaryCard({ labRequestId, testType, urgency, facility, provider, status }: Props) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Lab Request {labRequestId}</CardTitle>
          <CardDescription>Laboratory workflow summary</CardDescription>
        </div>
        <StatusBadge status={status} />
      </CardHeader>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs text-muted">Test Type</p><p className="font-medium text-foreground">{testType}</p></div>
        <div><p className="text-xs text-muted">Urgency</p><p className="font-medium text-foreground">{urgency}</p></div>
        <div><p className="text-xs text-muted">Lab Facility</p><p className="font-medium text-foreground">{facility}</p></div>
        <div><p className="text-xs text-muted">Requester</p><p className="font-medium text-foreground">{provider}</p></div>
      </div>
    </Card>
  );
}
