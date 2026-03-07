import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Drawer } from '@/components/overlays/Drawer';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SmartSelect } from '@/components/data/SmartSelect';

const escalationSchema = z.object({
  targetLevel: z.enum(['STATE', 'NATIONAL']),
  targetUnit: z.string().min(1, 'Target unit is required'),
  reason: z.string().min(8, 'Reason should be descriptive'),
  priority: z.string().min(1, 'Priority is required'),
  notes: z.string().max(500).optional(),
});

export type EscalationValues = z.infer<typeof escalationSchema>;

type UnitOption = { value: string; label: string; description?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onSubmit: (values: EscalationValues) => Promise<void>;
  units?: UnitOption[];
};

export function EscalationFormDrawer({ open, onOpenChange, title, onSubmit, units = [] }: Props) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EscalationValues>({
    resolver: zodResolver(escalationSchema),
    defaultValues: {
      targetLevel: 'STATE',
      targetUnit: '',
      reason: '',
      priority: 'high',
      notes: '',
    },
  });

  const targetLevel = watch('targetLevel');
  const targetUnit = watch('targetUnit');
  const priority = watch('priority');
  const priorities = useMemo(
    () => [
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ],
    [],
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          if (!window.confirm('Confirm escalation for this workflow item?')) return;
          await onSubmit(values);
          toast.success('Escalation submitted');
          reset();
          onOpenChange(false);
        })}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Target Level</label>
            <SmartSelect
              value={targetLevel}
              onChange={(value) => setValue('targetLevel', value as 'STATE' | 'NATIONAL', { shouldValidate: true })}
              loadOptions={async () => [
                { value: 'STATE', label: 'State Taskforce' },
                { value: 'NATIONAL', label: 'National Taskforce' },
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Priority</label>
            <SmartSelect
              value={priority}
              onChange={(value) => setValue('priority', value, { shouldValidate: true })}
              loadOptions={async (input) => priorities.filter((item) => item.label.toLowerCase().includes(input.toLowerCase()))}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Target Unit</label>
          <SmartSelect
            value={targetUnit || null}
            onChange={(value) => setValue('targetUnit', value, { shouldValidate: true })}
            placeholder="Select target unit"
            loadOptions={async (input) =>
              units.filter((item) => item.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
          {errors.targetUnit ? <p className="text-xs text-danger">{errors.targetUnit.message}</p> : null}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Reason</label>
          <Input {...register('reason')} placeholder="Escalation reason" />
          {errors.reason ? <p className="text-xs text-danger">{errors.reason.message}</p> : null}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            {...register('notes')}
            className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            placeholder="Optional details"
          />
          {errors.notes ? <p className="text-xs text-danger">{errors.notes.message}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Escalating...' : 'Submit Escalation'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
