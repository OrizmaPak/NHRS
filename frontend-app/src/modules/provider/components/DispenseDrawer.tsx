import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Drawer } from '@/components/overlays/Drawer';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

const schema = z.object({
  quantityDispensed: z.string().min(1, 'Quantity is required'),
  dispensedBy: z.string().min(1, 'Dispensed by is required'),
  dispensedDate: z.string().min(1, 'Dispensed date is required'),
  notes: z.string().max(500).optional(),
  status: z.string().min(1, 'Status is required'),
});

type Values = z.infer<typeof schema>;

export function DispenseDrawer({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: Values) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantityDispensed: '',
      dispensedBy: '',
      dispensedDate: '',
      notes: '',
      status: 'dispensed',
    },
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Dispense Prescription">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          await onSubmit(values);
          toast.success('Dispense update saved');
          reset();
          onOpenChange(false);
        })}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Quantity Dispensed</label>
          <Input {...register('quantityDispensed')} />
          {errors.quantityDispensed ? <p className="text-xs text-danger">{errors.quantityDispensed.message}</p> : null}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Dispensed By</label>
          <Input {...register('dispensedBy')} />
          {errors.dispensedBy ? <p className="text-xs text-danger">{errors.dispensedBy.message}</p> : null}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Dispensed Date</label>
          <Input type="datetime-local" {...register('dispensedDate')} />
          {errors.dispensedDate ? <p className="text-xs text-danger">{errors.dispensedDate.message}</p> : null}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Status</label>
          <Input {...register('status')} />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            {...register('notes')}
            className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          />
          {errors.notes ? <p className="text-xs text-danger">{errors.notes.message}</p> : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Dispense'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
