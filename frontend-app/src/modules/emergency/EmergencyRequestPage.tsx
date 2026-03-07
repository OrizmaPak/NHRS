import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { ActionBar } from '@/components/data/ActionBar';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCreateEmergencyRequest } from '@/api/hooks/useEmergencyInventory';

const schema = z.object({
  resourceType: z.string().min(2, 'Select a resource type'),
  quantity: z.number().int().positive('Quantity is required'),
  location: z.string().min(2, 'Location is required'),
  urgency: z.enum(['critical', 'high', 'medium']),
  notes: z.string().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

export function EmergencyRequestPage() {
  const navigate = useNavigate();
  const createRequest = useCreateEmergencyRequest();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      resourceType: '',
      quantity: 1,
      location: '',
      urgency: 'high',
      notes: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await createRequest.mutateAsync(values);
    toast.success('Emergency request submitted');
    navigate('/app/emergency');
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request Emergency Resource"
        description="Submit a scoped emergency resource request with urgency and location."
        breadcrumbs={[{ label: 'Emergency' }, { label: 'Request Resource' }]}
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <div>
            <CardTitle>Request details</CardTitle>
            <CardDescription>All fields are validated and submitted directly to emergency intake.</CardDescription>
          </div>
        </CardHeader>
        <form className="space-y-4 px-6 pb-6" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Resource type" error={form.formState.errors.resourceType?.message}>
              <Input placeholder="e.g. blood, drug, equipment" {...form.register('resourceType')} />
            </FormField>
            <FormField label="Quantity" error={form.formState.errors.quantity?.message}>
              <Input type="number" min={1} {...form.register('quantity', { valueAsNumber: true })} />
            </FormField>
            <FormField label="Location (State/LGA)" error={form.formState.errors.location?.message}>
              <Input placeholder="Lagos / Ikeja" {...form.register('location')} />
            </FormField>
            <FormField label="Urgency" error={form.formState.errors.urgency?.message}>
              <select
                {...form.register('urgency')}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
              </select>
            </FormField>
          </div>
          <FormField label="Notes" error={form.formState.errors.notes?.message}>
            <textarea
              {...form.register('notes')}
              className="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              placeholder="Additional details for responders"
            />
          </FormField>
          <ActionBar>
            <p className="mr-auto text-xs text-muted">
              Urgency guides response prioritization. Use <strong>critical</strong> for life-threatening needs.
            </p>
            <Button type="button" variant="outline" onClick={() => navigate('/app/emergency')}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRequest.isPending}>
              {createRequest.isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </ActionBar>
        </form>
      </Card>
    </div>
  );
}
