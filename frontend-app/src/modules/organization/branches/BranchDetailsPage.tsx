import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useBranchById, useUpdateBranch } from '@/api/hooks/useInstitutions';

const schema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  status: z.string().optional(),
  capabilitiesCsv: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export function BranchDetailsPage() {
  const { branchId = '' } = useParams();
  const navigate = useNavigate();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const canEdit = hasPermission('org.branch.update');
  const [editOpen, setEditOpen] = useState(false);

  const detailsQuery = useBranchById(branchId);
  const updateBranch = useUpdateBranch();
  const branch = detailsQuery.data?.branch ?? null;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: branch?.name ?? '',
      code: branch?.code ?? '',
      status: branch?.status ?? 'active',
      capabilitiesCsv: branch?.capabilities.join(',') ?? '',
      state: branch?.state === 'N/A' ? '' : branch?.state ?? '',
      lga: branch?.lga === 'N/A' ? '' : branch?.lga ?? '',
    },
  });

  if (!branchId) return <ErrorState title="Branch not found" description="Invalid branch identifier." />;
  if (detailsQuery.isError) return <ErrorState title="Unable to load branch details" description="Retry loading branch profile." onRetry={() => detailsQuery.refetch()} />;
  if (!branch) return <EmptyState title="Branch not found" description="You may not have access to this branch." />;

  const onSubmit = form.handleSubmit(async (values) => {
    const capabilities = String(values.capabilitiesCsv || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean) as Array<'hospital' | 'clinic' | 'laboratory' | 'pharmacy'>;
    await updateBranch.mutateAsync({
      orgId: branch.organizationId,
      institutionId: branch.institutionId,
      branchId: branch.branchId,
      name: values.name,
      code: values.code,
      status: values.status as 'active' | 'closed' | 'suspended',
      capabilities,
      location: {
        state: values.state || undefined,
        lga: values.lga || undefined,
      },
    });
    setEditOpen(false);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={branch.name}
        description={detailsQuery.data?.viewerScope?.message || 'Branch details and branch-scoped operations.'}
        breadcrumbs={[
          { label: 'Organization' },
          { label: 'Branches', href: '/app/branches' },
          { label: branch.name },
        ]}
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/app/branches/${branch.branchId}/staff`)}>
              <Users className="h-4 w-4" />
              View Staff
            </Button>
            {canEdit ? <Button onClick={() => setEditOpen(true)}>Edit Branch</Button> : null}
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Branch Details</CardTitle>
              <CardDescription>This is a standalone branch workspace.</CardDescription>
            </div>
            <StatusBadge status={branch.status} />
          </div>
        </CardHeader>
        <div className="grid gap-4 p-6 pt-0 md:grid-cols-2 xl:grid-cols-4">
          <div><p className="text-xs text-muted">Branch ID</p><p className="text-sm text-foreground">{branch.branchId}</p></div>
          <div><p className="text-xs text-muted">Organization ID</p><p className="text-sm text-foreground">{branch.organizationId}</p></div>
          <div><p className="text-xs text-muted">Institution ID</p><p className="text-sm text-foreground">{branch.institutionId}</p></div>
          <div><p className="text-xs text-muted">Code</p><p className="text-sm text-foreground">{branch.code}</p></div>
          <div><p className="text-xs text-muted">Type</p><p className="text-sm text-foreground">{branch.type || 'N/A'}</p></div>
          <div><p className="text-xs text-muted">Capabilities</p><p className="text-sm text-foreground">{branch.capabilities.join(', ') || 'N/A'}</p></div>
          <div><p className="text-xs text-muted">State</p><p className="text-sm text-foreground">{branch.state}</p></div>
          <div><p className="text-xs text-muted">LGA</p><p className="text-sm text-foreground">{branch.lga}</p></div>
        </div>
      </Card>

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Edit Branch">
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Branch Name"><Input {...form.register('name')} /></FormField>
            <FormField label="Code"><Input {...form.register('code')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Status">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...form.register('status')}>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="suspended">Suspended</option>
              </select>
            </FormField>
            <FormField label="Capabilities (comma-separated)"><Input {...form.register('capabilitiesCsv')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State"><Input {...form.register('state')} /></FormField>
            <FormField label="LGA"><Input {...form.register('lga')} /></FormField>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={updateBranch.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
