import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { GitBranch, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useCreateBranch, useInstitutionBranches, useInstitutionById, useUpdateOrgInstitution } from '@/api/hooks/useInstitutions';

const editSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
});
type EditValues = z.infer<typeof editSchema>;

const branchSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  state: z.string().optional(),
  lga: z.string().optional(),
  capabilitiesCsv: z.string().optional(),
});
type BranchValues = z.infer<typeof branchSchema>;

function cap(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function InstitutionDetailsPage() {
  const { institutionId = '' } = useParams();
  const navigate = useNavigate();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const canEdit = hasPermission('org.branch.update');
  const canCreateBranch = hasPermission('org.branch.create');
  const [editOpen, setEditOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  const detailsQuery = useInstitutionById(institutionId);
  const institution = detailsQuery.data?.institution ?? null;
  const orgId = institution?.organizationId;
  const branchesQuery = useInstitutionBranches(orgId, institution?.institutionId);
  const updateInstitution = useUpdateOrgInstitution();
  const createBranch = useCreateBranch();

  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: {
      name: institution?.name ?? '',
      code: institution?.code ?? '',
      type: institution?.type ?? '',
      status: institution?.status ?? 'active',
      state: institution?.state === 'N/A' ? '' : institution?.state ?? '',
      lga: institution?.lga === 'N/A' ? '' : institution?.lga ?? '',
    },
  });

  const branchForm = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: { name: '', code: '', state: '', lga: '', capabilitiesCsv: 'hospital' },
  });

  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);

  if (!institutionId) return <ErrorState title="Institution not found" description="Invalid institution identifier." />;
  if (detailsQuery.isError) return <ErrorState title="Unable to load institution details" description="Retry loading institution profile." onRetry={() => detailsQuery.refetch()} />;
  if (!institution) return <EmptyState title="Institution not found" description="You may not have access to this institution." />;

  const onEditSubmit = editForm.handleSubmit(async (values) => {
    if (!orgId) return;
    await updateInstitution.mutateAsync({
      orgId,
      institutionId: institution.institutionId,
      name: values.name,
      code: values.code || undefined,
      type: values.type as never,
      status: values.status as 'active' | 'inactive' | 'suspended',
      location: { state: values.state || undefined, lga: values.lga || undefined },
    });
    setEditOpen(false);
  });

  const onCreateBranch = branchForm.handleSubmit(async (values) => {
    if (!orgId) return;
    const capabilities = String(values.capabilitiesCsv || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean) as Array<'hospital' | 'clinic' | 'laboratory' | 'pharmacy'>;
    await createBranch.mutateAsync({
      orgId,
      institutionId: institution.institutionId,
      name: values.name,
      code: values.code,
      capabilities: capabilities.length > 0 ? capabilities : ['hospital'],
      location: { state: values.state || undefined, lga: values.lga || undefined },
    });
    setBranchOpen(false);
    branchForm.reset({ name: '', code: '', state: '', lga: '', capabilitiesCsv: 'hospital' });
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={institution.name}
        description={detailsQuery.data?.viewerScope?.message || 'Institution details and branch operations.'}
        breadcrumbs={[
          { label: 'Organization' },
          { label: 'Institutions', href: '/app/institutions' },
          { label: institution.name },
        ]}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate(`/app/institutions/${institution.institutionId}/staff`)}>
              <Users className="h-4 w-4" />
              View Staff
            </Button>
            <Button variant="outline" onClick={() => navigate(`/app/branches?institutionId=${encodeURIComponent(institution.institutionId)}&orgId=${encodeURIComponent(orgId || '')}`)}>
              <GitBranch className="h-4 w-4" />
              View Branches
            </Button>
            {canCreateBranch ? <Button onClick={() => setBranchOpen(true)}>Create Branch</Button> : null}
            {canEdit ? <Button variant="outline" onClick={() => setEditOpen(true)}>Edit Institution</Button> : null}
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Institution Details</CardTitle>
              <CardDescription>Standalone institution workspace.</CardDescription>
            </div>
            <StatusBadge status={institution.status} />
          </div>
        </CardHeader>
        <div className="grid gap-4 p-6 pt-0 md:grid-cols-2 xl:grid-cols-4">
          <div><p className="text-xs text-muted">Institution ID</p><p className="text-sm text-foreground">{institution.institutionId}</p></div>
          <div><p className="text-xs text-muted">Organization ID</p><p className="text-sm text-foreground">{institution.organizationId}</p></div>
          <div><p className="text-xs text-muted">Type</p><p className="text-sm text-foreground">{cap(institution.type)}</p></div>
          <div><p className="text-xs text-muted">Code</p><p className="text-sm text-foreground">{institution.code}</p></div>
          <div><p className="text-xs text-muted">State</p><p className="text-sm text-foreground">{institution.state}</p></div>
          <div><p className="text-xs text-muted">LGA</p><p className="text-sm text-foreground">{institution.lga}</p></div>
          <div><p className="text-xs text-muted">HQ</p><p className="text-sm text-foreground">{institution.isHeadquarters ? 'Yes' : 'No'}</p></div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <CardDescription>Branches under this institution.</CardDescription>
        </CardHeader>
        <div className="space-y-2 p-6 pt-0">
          {branches.length === 0 ? <p className="text-sm text-muted">No branches available.</p> : branches.map((branch) => (
            <Link key={branch.branchId} to={`/app/branches/${branch.branchId}`} className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:bg-muted/40">
              <span>{branch.name}</span>
              <StatusBadge status={branch.status} />
            </Link>
          ))}
        </div>
      </Card>

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Edit Institution">
        <form className="space-y-3" onSubmit={onEditSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Name"><Input {...editForm.register('name')} /></FormField>
            <FormField label="Code"><Input {...editForm.register('code')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Type"><Input {...editForm.register('type')} /></FormField>
            <FormField label="Status">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...editForm.register('status')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State"><Input {...editForm.register('state')} /></FormField>
            <FormField label="LGA"><Input {...editForm.register('lga')} /></FormField>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={updateInstitution.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={branchOpen} onOpenChange={setBranchOpen} title="Create Branch">
        <form className="space-y-3" onSubmit={onCreateBranch}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Branch Name"><Input {...branchForm.register('name')} /></FormField>
            <FormField label="Code"><Input {...branchForm.register('code')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State"><Input {...branchForm.register('state')} /></FormField>
            <FormField label="LGA"><Input {...branchForm.register('lga')} /></FormField>
          </div>
          <FormField label="Capabilities (comma-separated)">
            <Input {...branchForm.register('capabilitiesCsv')} placeholder="hospital,laboratory" />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setBranchOpen(false)}>Cancel</Button>
            <Button type="submit" loading={createBranch.isPending}>Create</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
