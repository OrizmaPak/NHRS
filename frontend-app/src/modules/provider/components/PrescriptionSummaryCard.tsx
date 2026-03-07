import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';

type Props = {
  prescriptionId: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  facility: string;
  status: string;
};

export function PrescriptionSummaryCard({
  prescriptionId,
  medicationName,
  dosage,
  frequency,
  facility,
  status,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Prescription {prescriptionId}</CardTitle>
          <CardDescription>Pharmacy dispensing workflow summary</CardDescription>
        </div>
        <StatusBadge status={status} />
      </CardHeader>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs text-muted">Medication</p><p className="font-medium text-foreground">{medicationName}</p></div>
        <div><p className="text-xs text-muted">Dosage</p><p className="font-medium text-foreground">{dosage}</p></div>
        <div><p className="text-xs text-muted">Frequency</p><p className="font-medium text-foreground">{frequency}</p></div>
        <div><p className="text-xs text-muted">Facility</p><p className="font-medium text-foreground">{facility}</p></div>
      </div>
    </Card>
  );
}
