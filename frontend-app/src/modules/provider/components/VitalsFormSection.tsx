import { Input } from '@/components/ui/Input';

type Props = {
  values: { bp?: string; temp?: string; pulse?: string; weight?: string };
  onChange: (next: { bp?: string; temp?: string; pulse?: string; weight?: string }) => void;
};

export function VitalsFormSection({ values, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Blood Pressure</label>
        <Input value={values.bp ?? ''} onChange={(e) => onChange({ ...values, bp: e.target.value })} placeholder="120/80" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Temperature</label>
        <Input value={values.temp ?? ''} onChange={(e) => onChange({ ...values, temp: e.target.value })} placeholder="36.8 C" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Pulse</label>
        <Input value={values.pulse ?? ''} onChange={(e) => onChange({ ...values, pulse: e.target.value })} placeholder="72 bpm" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Weight</label>
        <Input value={values.weight ?? ''} onChange={(e) => onChange({ ...values, weight: e.target.value })} placeholder="70 kg" />
      </div>
    </div>
  );
}
