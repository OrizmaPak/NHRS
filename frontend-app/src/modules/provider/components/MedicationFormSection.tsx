import { Input } from '@/components/ui/Input';

export type MedicationFormValues = {
  medicationName: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};

export function MedicationFormSection({
  values,
  onChange,
  showRoute = true,
}: {
  values: MedicationFormValues;
  onChange: (values: MedicationFormValues) => void;
  showRoute?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Medication Name</label>
          <Input value={values.medicationName} onChange={(e) => onChange({ ...values, medicationName: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Dosage</label>
          <Input value={values.dosage} onChange={(e) => onChange({ ...values, dosage: e.target.value })} />
        </div>
        {showRoute ? (
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Route</label>
            <Input value={values.route} onChange={(e) => onChange({ ...values, route: e.target.value })} />
          </div>
        ) : null}
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Frequency</label>
          <Input value={values.frequency} onChange={(e) => onChange({ ...values, frequency: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Duration</label>
          <Input value={values.duration} onChange={(e) => onChange({ ...values, duration: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Quantity</label>
          <Input value={values.quantity} onChange={(e) => onChange({ ...values, quantity: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Instructions</label>
        <textarea
          value={values.instructions}
          onChange={(e) => onChange({ ...values, instructions: e.target.value })}
          className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        />
      </div>
    </div>
  );
}
