import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Drawer } from '@/components/overlays/Drawer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';

const assignmentSchema = z.object({
  assigneeId: z.string().min(1, 'Assignee is required'),
  dueDate: z.string().optional(),
  priority: z.string().min(1, 'Priority is required'),
  comment: z.string().max(500, 'Comment is too long').optional(),
});

type AssignmentValues = z.infer<typeof assignmentSchema>;

type OfficerOption = { value: string; label: string; description?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetLabel: string;
  initialPriority?: string;
  officers?: OfficerOption[];
  onSubmit: (values: AssignmentValues) => Promise<void>;
};

export function AssignmentDrawer({
  open,
  onOpenChange,
  targetLabel,
  initialPriority = 'medium',
  officers = [],
  onSubmit,
}: Props) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignmentValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: {
      assigneeId: '',
      dueDate: '',
      priority: initialPriority,
      comment: '',
    },
  });

  const selectedOfficer = watch('assigneeId');
  const selectedPriority = watch('priority');
  const priorities = useMemo(
    () => [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ],
    [],
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={`Assign ${targetLabel}`}>
      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          await onSubmit(values);
          toast.success(`${targetLabel} assignment updated`);
          reset();
          onOpenChange(false);
        })}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Assign Officer</label>
          <SmartSelect
            value={selectedOfficer || null}
            onChange={(value) => setValue('assigneeId', value, { shouldValidate: true })}
            placeholder="Select officer"
            loadOptions={async (input) =>
              officers.filter((item) => item.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
          {errors.assigneeId ? <p className="text-xs text-danger">{errors.assigneeId.message}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Due date</label>
            <Input type="date" {...register('dueDate')} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Priority</label>
            <SmartSelect
              value={selectedPriority}
              onChange={(value) => setValue('priority', value, { shouldValidate: true })}
              placeholder="Set priority"
              loadOptions={async (input) =>
                priorities.filter((item) => item.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
            {errors.priority ? <p className="text-xs text-danger">{errors.priority.message}</p> : null}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Comment</label>
          <textarea
            {...register('comment')}
            className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            placeholder="Add assignment note"
          />
          {errors.comment ? <p className="text-xs text-danger">{errors.comment.message}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Assignment'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
