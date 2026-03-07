import { Input } from '@/components/ui/Input';

type Values = {
  resultSummary: string;
  observations: string;
  interpretation: string;
  completedDate: string;
  status: string;
};

export function ResultEntrySection({
  values,
  onChange,
}: {
  values: Values;
  onChange: (values: Values) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Result Summary</label>
        <Input value={values.resultSummary} onChange={(e) => onChange({ ...values, resultSummary: e.target.value })} />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Observations</label>
        <textarea
          value={values.observations}
          onChange={(e) => onChange({ ...values, observations: e.target.value })}
          className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Interpretation</label>
        <textarea
          value={values.interpretation}
          onChange={(e) => onChange({ ...values, interpretation: e.target.value })}
          className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Completed Date</label>
          <Input type="datetime-local" value={values.completedDate} onChange={(e) => onChange({ ...values, completedDate: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Status</label>
          <Input value={values.status} onChange={(e) => onChange({ ...values, status: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
