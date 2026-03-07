import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';

type Props = {
  encounterId: string;
  encounterType: string;
  visitDate: string;
  clinician: string;
  facility: string;
  status: string;
};

export function EncounterSummaryCard({ encounterId, encounterType, visitDate, clinician, facility, status }: Props) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Encounter {encounterId}</CardTitle>
          <CardDescription>Clinical encounter summary</CardDescription>
        </div>
        <StatusBadge status={status} />
      </CardHeader>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs text-muted">Type</p><p className="font-medium text-foreground">{encounterType}</p></div>
        <div><p className="text-xs text-muted">Visit Date</p><p className="font-medium text-foreground">{visitDate}</p></div>
        <div><p className="text-xs text-muted">Clinician</p><p className="font-medium text-foreground">{clinician}</p></div>
        <div><p className="text-xs text-muted">Facility</p><p className="font-medium text-foreground">{facility}</p></div>
      </div>
    </Card>
  );
}
