import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Drawer } from '@/components/overlays/Drawer';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';

const schema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'cancelled']),
  reason: z.string().max(1000).optional(),
});

type Values = z.infer<typeof schema>;

export function UpdateEmergencyStatusDrawer({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: Values) => Promise<void>;
}) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { status: 'in_progress', reason: '' },
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Update Case Status">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          await onSubmit(values);
          reset();
          onOpenChange(false);
        })}
      >
        <FormField label="Status" error={errors.status?.message}>
          <select
            {...register('status')}
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <option value="open">open</option>
            <option value="in_progress">in progress</option>
            <option value="resolved">resolved</option>
            <option value="cancelled">cancelled</option>
          </select>
        </FormField>

        <FormField label="Reason / Notes" error={errors.reason?.message}>
          <textarea
            {...register('reason')}
            className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            placeholder="Operational status context"
          />
        </FormField>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={isSubmitting} loadingText="Updating...">Update Status</Button>
        </div>
      </form>
    </Drawer>
  );
}

