import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldX, Trash2, UserCog } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import {
  useOrgDetails,
  useRequestOrganizationDeletion,
  useRestoreOrganization,
  useUpdateOrganization,
  useUploadOrganizationFile,
} from '@/api/hooks/useInstitutions';
import { useGeoLgas, useGeoStates } from '@/api/hooks/useGeography';
import { useAuditEvents } from '@/api/hooks/useAuditEvents';

const formSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  registrationNumber: z.string().optional(),
  ownerType: z.string().optional(),
  foundedAt: z.string().optional(),
  openedAt: z.string().optional(),
  website: z.string().optional(),
  state: z.string().min(2, 'State is required'),
  lga: z.string().min(2, 'LGA is required'),
});
type FormValues = z.infer<typeof formSchema>;

function cap(value: string) {
  if (!value) return value;
  return value
    .split(/[_\s-]+/)
    .map((entry) => (entry ? `${entry[0].toUpperCase()}${entry.slice(1)}` : ''))
    .join(' ');
}

export function OrganizationDetailsPage() {
  const { orgId = '' } = useParams();
  const navigate = useNavigate();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const activeContext = useContextStore((state) => state.activeContext);
  const contextOrganizationId = getOrganizationIdFromContext(activeContext);
  const canEdit = hasPermission('org.update');
  const canViewAudit = hasPermission('audit.read') || hasPermission('audit.view');
  const inOrganizationContext = activeContext?.type === 'organization';
  const inPlatformContext = activeContext?.type === 'platform';
  const [editOpen, setEditOpen] = useState(false);
  const [deleteRequestOpen, setDeleteRequestOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [cacFile, setCacFile] = useState<File | null>(null);

  const detailsQuery = useOrgDetails(orgId);
  const auditQuery = useAuditEvents(
    { page: 1, limit: 8, institution: orgId },
    { enabled: canViewAudit, suppressGlobalErrors: true },
  );
  const updateOrg = useUpdateOrganization();
  const requestDeletion = useRequestOrganizationDeletion();
  const restoreOrg = useRestoreOrganization();
  const uploadOrgFile = useUploadOrganizationFile();

  const org = detailsQuery.data?.organization ?? null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      registrationNumber: '',
      ownerType: '',
      foundedAt: '',
      openedAt: '',
      website: '',
      state: '',
      lga: '',
    },
  });
  const selectedStateName = form.watch('state') || '';
  const selectedLgaName = form.watch('lga') || '';
  const geoStatesQuery = useGeoStates();
  const geoStates = geoStatesQuery.data ?? [];
  const selectedState = geoStates.find((entry) => entry.name.toLowerCase() === selectedStateName.toLowerCase()) ?? null;
  const geoLgasQuery = useGeoLgas({
    stateId: selectedState?.stateId,
    includeInactive: false,
    enabled: Boolean(selectedState?.stateId),
  });
  const geoLgas = geoLgasQuery.data ?? [];
  const stateOptions = useMemo(() => {
    const options = geoStates.map((entry) => ({ value: entry.name, label: entry.name }));
    if (selectedStateName && !options.some((entry) => entry.value.toLowerCase() === selectedStateName.toLowerCase())) {
      options.unshift({ value: selectedStateName, label: selectedStateName });
    }
    return options;
  }, [geoStates, selectedStateName]);
  const lgaOptions = useMemo(() => {
    const options = geoLgas.map((entry) => ({ value: entry.name, label: entry.name }));
    if (selectedLgaName && !options.some((entry) => entry.value.toLowerCase() === selectedLgaName.toLowerCase())) {
      options.unshift({ value: selectedLgaName, label: selectedLgaName });
    }
    return options;
  }, [geoLgas, selectedLgaName]);

  useEffect(() => {
    if (!org) return;
    form.reset({
      name: org.name ?? '',
      description: org.description ?? '',
      registrationNumber: org.registrationNumber ?? '',
      ownerType: org.ownerType ?? '',
      foundedAt: org.foundedAt ? String(org.foundedAt).slice(0, 10) : '',
      openedAt: org.openedAt ? String(org.openedAt).slice(0, 10) : '',
      website: org.website ?? '',
      state: org.state === 'N/A' ? '' : org.state ?? '',
      lga: org.lga === 'N/A' ? '' : org.lga ?? '',
    });
  }, [form, org]);

  if (!orgId) {
    return <ErrorState title="Organization not found" description="Invalid organization identifier." />;
  }

  if (detailsQuery.isError) {
    return <ErrorState title="Unable to load organization details" description="Retry loading this organization profile." onRetry={() => detailsQuery.refetch()} />;
  }

  if (!org) {
    return <EmptyState title="No organization found" description="This organization may have been removed or you may not have visibility." />;
  }
  if (inOrganizationContext && contextOrganizationId && org.organizationId !== contextOrganizationId) {
    return (
      <ErrorState
        title="Organization not in active context"
        description="Switch to the correct organization context to view this workspace."
        onRetry={() => navigate(`/app/organizations/${contextOrganizationId}`)}
      />
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    await updateOrg.mutateAsync({
      orgId: org.organizationId,
      name: values.name,
      description: values.description || undefined,
      registrationNumber: values.registrationNumber || undefined,
      ownerType: values.ownerType || undefined,
      foundedAt: values.foundedAt ? new Date(values.foundedAt).toISOString() : undefined,
      openedAt: values.openedAt ? new Date(values.openedAt).toISOString() : undefined,
      website: values.website || undefined,
      location: {
        state: values.state || undefined,
        lga: values.lga || undefined,
      },
    });
    if (logoFile) {
      await uploadOrgFile.mutateAsync({ orgId: org.organizationId, kind: 'logo', file: logoFile });
      setLogoFile(null);
    }
    if (cacFile) {
      await uploadOrgFile.mutateAsync({ orgId: org.organizationId, kind: 'cac', file: cacFile });
      setCacFile(null);
    }
    setEditOpen(false);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        description={detailsQuery.data?.viewerScope?.message || 'Organization profile and oversight view.'}
        breadcrumbs={[
          { label: 'Organization' },
          { label: 'Organizations', href: inPlatformContext ? '/app/organizations' : undefined },
          { label: org.name },
        ]}
        actions={(
          <div className="flex flex-wrap gap-2">
            {inOrganizationContext ? (
              <PermissionGate permission="org.member.read">
                <Button variant="outline" onClick={() => navigate(`/app/organizations/${org.organizationId}/staff`)}>
                  <UserCog className="h-4 w-4" />
                  Manage Staff
                </Button>
              </PermissionGate>
            ) : null}
            {canEdit ? <Button variant="outline" onClick={() => setEditOpen(true)}>Edit Organization</Button> : null}
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>Approval status controls whether institutions and branches can operate.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={org.approvalStatus || 'pending'} />
              <StatusBadge status={org.lifecycleStatus || org.status || 'active'} />
            </div>
          </div>
        </CardHeader>
        <div className="grid gap-4 p-6 pt-0 md:grid-cols-2 xl:grid-cols-4">
          <div><p className="text-xs text-muted">Organization ID</p><p className="text-sm text-foreground">{org.organizationId}</p></div>
          <div><p className="text-xs text-muted">Owner Type</p><p className="text-sm text-foreground">{cap(org.ownerType || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">Registration</p><p className="text-sm text-foreground">{org.registrationNumber || 'Not set'}</p></div>
          <div><p className="text-xs text-muted">Founded</p><p className="text-sm text-foreground">{org.foundedAt ? new Date(org.foundedAt).toLocaleDateString() : 'N/A'}</p></div>
          <div><p className="text-xs text-muted">Opened</p><p className="text-sm text-foreground">{org.openedAt ? new Date(org.openedAt).toLocaleDateString() : 'N/A'}</p></div>
          <div><p className="text-xs text-muted">State</p><p className="text-sm text-foreground">{org.state}</p></div>
          <div><p className="text-xs text-muted">LGA</p><p className="text-sm text-foreground">{org.lga}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">Website</p><p className="text-sm text-foreground">{org.website || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">Logo</p><p className="truncate text-sm text-foreground">{org.logoUrl || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">CAC Document URL</p><p className="truncate text-sm text-foreground">{org.cacDocumentUrl || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">Description</p><p className="text-sm text-foreground">{org.description || 'No description'}</p></div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border p-6 pt-4">
          <PermissionGate permission="org.update">
            <>
              {org.lifecycleStatus === 'delete_pending' ? (
                <Button variant="outline" onClick={() => navigate('/app/organizations/approvals')}>
                  <ShieldX className="h-4 w-4" />
                  Deletion Pending Review
                </Button>
              ) : org.lifecycleStatus === 'deleted' ? (
                <Button onClick={() => restoreOrg.mutate({ orgId: org.organizationId })} loading={restoreOrg.isPending}>
                  Restore Organization
                </Button>
              ) : (
                <Button variant="outline" onClick={() => { setDeleteReason(''); setDeleteRequestOpen(true); }}>
                  <Trash2 className="h-4 w-4" />
                  Request Deletion
                </Button>
              )}
            </>
          </PermissionGate>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Organization Activity</CardTitle>
          <CardDescription>Audit events for this organization.</CardDescription>
        </CardHeader>
        <div className="space-y-2 p-6 pt-0">
          {!canViewAudit ? <p className="text-sm text-muted">No audit visibility in the current role context.</p> : null}
          {auditQuery.isLoading ? <p className="text-sm text-muted">Loading activity...</p> : null}
          {canViewAudit && auditQuery.isError ? <p className="text-sm text-muted">Unable to load activity right now.</p> : null}
          {canViewAudit && (auditQuery.data?.rows ?? []).length === 0 ? <p className="text-sm text-muted">No recent activity.</p> : null}
          {canViewAudit ? (auditQuery.data?.rows ?? []).map((event) => (
            <div key={event.eventId} className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-foreground">{event.action}</p>
              <p className="text-muted">{event.actor} - {new Date(event.timestamp).toLocaleString()}</p>
            </div>
          )) : null}
        </div>
      </Card>

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Edit Organization">
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Name"><Input {...form.register('name')} /></FormField>
            <FormField label="Registration Number"><Input {...form.register('registrationNumber')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Owner Type"><Input {...form.register('ownerType')} /></FormField>
            <FormField label="Website"><Input {...form.register('website')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Founded Date"><Input type="date" {...form.register('foundedAt')} /></FormField>
            <FormField label="Opened Date"><Input type="date" {...form.register('openedAt')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State">
              <SmartSelect
                value={form.watch('state') || null}
                onChange={(next) => {
                  form.setValue('state', next, { shouldDirty: true, shouldValidate: true });
                  form.setValue('lga', '', { shouldDirty: true, shouldValidate: true });
                }}
                placeholder={geoStatesQuery.isLoading ? 'Loading states...' : 'Select state'}
                debounceMs={200}
                loadOptions={async (input) =>
                  stateOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </FormField>
            <FormField label="LGA">
              {selectedState ? (
                <SmartSelect
                  value={form.watch('lga') || null}
                  onChange={(next) => form.setValue('lga', next, { shouldDirty: true, shouldValidate: true })}
                  placeholder={geoLgasQuery.isLoading ? 'Loading LGAs...' : 'Select LGA'}
                  debounceMs={200}
                  loadOptions={async (input) =>
                    lgaOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                  }
                />
              ) : (
                <Input value="" readOnly placeholder="Select state first" />
              )}
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Logo Upload (optional)">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
              />
            </FormField>
            <FormField label="CAC Upload (optional)">
              <Input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => setCacFile(event.target.files?.[0] || null)}
              />
            </FormField>
          </div>
          <FormField label="Description"><Input {...form.register('description')} /></FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={updateOrg.isPending || uploadOrgFile.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={deleteRequestOpen} onOpenChange={setDeleteRequestOpen} title="Request Organization Deletion">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await requestDeletion.mutateAsync({
              orgId: org.organizationId,
              reason: deleteReason || undefined,
            });
            setDeleteRequestOpen(false);
          }}
        >
          <FormField label="Reason (optional)">
            <Input value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteRequestOpen(false)}>Cancel</Button>
            <Button type="submit" loading={requestDeletion.isPending}>Request</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
