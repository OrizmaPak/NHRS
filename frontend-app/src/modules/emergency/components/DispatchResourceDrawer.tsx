import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Drawer } from '@/components/overlays/Drawer';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { Button } from '@/components/ui/Button';

const schema = z.object({
  resourceType: z.string().min(1, 'Resource type is required'),
  originInstitution: z.string().min(1, 'Origin institution is required'),
  destination: z.string().min(1, 'Destination is required'),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  notes: z.string().max(1000).optional(),
});

type Values = z.infer<typeof schema>;

const resourceOptions = ['ambulance', 'blood_units', 'trauma_team', 'icu_bed', 'critical_meds', 'lab_support'];
const institutionOptions = ['National Trauma Center', 'Lagos General Hospital', 'FCT Medical Center', 'Rivers Specialist Hospital'];

export function DispatchResourceDrawer({
  open,
  onOpenChange,
  onDispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDispatch: (values: Values) => Promise<void>;
}) {
  const { register, setValue, watch, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      resourceType: '',
      originInstitution: '',
      destination: '',
      priority: 'high',
      notes: '',
    },
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Dispatch Resource">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          await onDispatch(values);
          reset();
          onOpenChange(false);
        })}
      >
        <FormField label="Resource type" error={errors.resourceType?.message}>
          <SmartSelect
            value={watch('resourceType') || null}
            onChange={(next) => setValue('resourceType', next, { shouldValidate: true })}
            placeholder="Select resource"
            loadOptions={async (input) =>
              resourceOptions
                .filter((option) => option.toLowerCase().includes(input.toLowerCase()))
                .map((option) => ({ value: option, label: option.replace('_', ' ') }))
            }
          />
        </FormField>

        <FormField label="Origin institution" error={errors.originInstitution?.message}>
          <SmartSelect
            value={watch('originInstitution') || null}
            onChange={(next) => setValue('originInstitution', next, { shouldValidate: true })}
            placeholder="Select origin"
            loadOptions={async (input) =>
              institutionOptions
                .filter((option) => option.toLowerCase().includes(input.toLowerCase()))
                .map((option) => ({ value: option, label: option }))
            }
          />
        </FormField>

        <FormField label="Destination" error={errors.destination?.message}>
          <Input {...register('destination')} placeholder="Destination facility or command unit" />
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

        <FormField label="Notes" error={errors.notes?.message}>
          <textarea
            {...register('notes')}
            className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            placeholder="Dispatch constraints, team notes, and expected ETA"
          />
        </FormField>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Dispatching...' : 'Dispatch Resource'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

