import { Input } from '@/components/ui/Input';

export function SpecimenSection({
  specimenInfo,
  onSpecimenInfoChange,
}: {
  specimenInfo: string;
  onSpecimenInfoChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-foreground">Specimen Information</label>
      <Input
        value={specimenInfo}
        onChange={(event) => onSpecimenInfoChange(event.target.value)}
        placeholder="e.g. Venous blood, fasting sample"
      />
    </div>
  );
}
