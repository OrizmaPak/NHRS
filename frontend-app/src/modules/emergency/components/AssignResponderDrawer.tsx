import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Drawer } from '@/components/overlays/Drawer';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { Button } from '@/components/ui/Button';

const schema = z.object({
  responder: z.string().min(1, 'Responder is required'),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  note: z.string().max(500).optional(),
});

type Values = z.infer<typeof schema>;
const responders = ['National Emergency Desk', 'State Rapid Response Unit', 'LGA Response Team', 'Hospital Command Lead'];

export function AssignResponderDrawer({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: Values) => Promise<void>;
}) {
  const { register, watch, setValue, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { responder: '', priority: 'high', note: '' },
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Assign Responder">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          await onSubmit(values);
          reset();
          onOpenChange(false);
        })}
      >
        <FormField label="Responder" error={errors.responder?.message}>
          <SmartSelect
            value={watch('responder') || null}
            onChange={(next) => setValue('responder', next, { shouldValidate: true })}
            placeholder="Choose responder"
            loadOptions={async (input) =>
              responders
                .filter((item) => item.toLowerCase().includes(input.toLowerCase()))
                .map((item) => ({ value: item, label: item }))
            }
          />
        </FormField>

        <FormField label="Priority" error={errors.priority?.message}>
          <select
            {...register('priority')}
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </FormField>

        <FormField label="Note" error={errors.note?.message}>
          <Input {...register('note')} placeholder="Assignment notes" />
        </FormField>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Assigning...' : 'Assign'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

