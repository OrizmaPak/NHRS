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
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { GlobalServicesSelector } from '@/components/forms/GlobalServicesSelector';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import { type BranchType, useCreateBranch, useInstitutionBranches, useInstitutionById, useUpdateOrgInstitution, useUploadInstitutionFiles } from '@/api/hooks/useInstitutions';
import { useGeoLgas, useGeoStates } from '@/api/hooks/useGeography';
import { getGlobalServiceKey, mergeGlobalServiceNames, useGlobalServices } from '@/api/hooks/useGlobalServices';

const editSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
  additionalServices: z.array(z.string()).default([]),
  openingHours: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().min(2, 'State is required'),
  lga: z.string().min(2, 'LGA is required'),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});
type EditValues = z.infer<typeof editSchema>;

const branchSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  type: z.enum(['hospital', 'clinic', 'laboratory', 'pharmacy']),
  additionalServices: z.array(z.string()).default([]),
  openingHours: z.string().optional(),
  addressLine1: z.string().optional(),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  state: z.string().min(2, 'State is required'),
  lga: z.string().min(2, 'LGA is required'),
});
type BranchValues = z.infer<typeof branchSchema>;

const branchTypeOptions: Array<{ value: BranchType; label: string }> = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
];
function cap(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function InstitutionDetailsPage() {
  const { institutionId = '' } = useParams();
  const navigate = useNavigate();
  const activeContext = useContextStore((state) => state.activeContext);
  const contextOrganizationId = getOrganizationIdFromContext(activeContext);
  const inOrganizationContext = activeContext?.type === 'organization';
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const canEdit = hasPermission('org.branch.update');
  const canCreateBranch = hasPermission('org.branch.create');
  const [editOpen, setEditOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);

  const detailsQuery = useInstitutionById(institutionId);
  const institution = detailsQuery.data?.institution ?? null;
  const orgId = institution?.organizationId;
  const branchesQuery = useInstitutionBranches(orgId, institution?.institutionId);
  const updateInstitution = useUpdateOrgInstitution();
  const createBranch = useCreateBranch();
  const uploadInstitutionFiles = useUploadInstitutionFiles();
  const globalServicesQuery = useGlobalServices({ limit: 500 });

  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: {
      name: institution?.name ?? '',
      code: institution?.code ?? '',
      type: institution?.type ?? '',
      status: institution?.status ?? 'active',
      description: institution?.description ?? '',
      additionalServices: institution?.additionalServices ?? [],
      openingHours: institution?.openingHours ?? '',
      addressLine1: String((institution?.address as Record<string, unknown> | null)?.line1 ?? ''),
      city: String((institution?.address as Record<string, unknown> | null)?.city ?? ''),
      state: institution?.state === 'N/A' ? '' : institution?.state ?? '',
      lga: institution?.lga === 'N/A' ? '' : institution?.lga ?? '',
      postalCode: String((institution?.address as Record<string, unknown> | null)?.postalCode ?? ''),
      phone: String((institution?.contact as Record<string, unknown> | null)?.phone ?? ''),
      email: String((institution?.contact as Record<string, unknown> | null)?.email ?? ''),
    },
  });

  const branchForm = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: {
      name: '',
      code: '',
      type: 'hospital',
      additionalServices: [],
      openingHours: '',
      addressLine1: '',
      postalCode: '',
      phone: '',
      email: '',
      state: '',
      lga: '',
    },
  });
  const selectedInstitutionType = editForm.watch('type');
  const selectedBranchType = branchForm.watch('type');
  const selectedInstitutionAdditionalServices = editForm.watch('additionalServices') || [];
  const selectedBranchAdditionalServices = branchForm.watch('additionalServices') || [];
  const institutionServiceOptions = useMemo(() => {
    const catalogRows = globalServicesQuery.data?.rows ?? [];
    const mergedNames = mergeGlobalServiceNames([
      ...catalogRows.map((entry) => entry.name),
      ...selectedInstitutionAdditionalServices,
    ]);
    return mergedNames
      .filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(selectedInstitutionType))
      .map((entry) => {
        const catalogMatch = catalogRows.find((row) => getGlobalServiceKey(row.name) === getGlobalServiceKey(entry));
        return {
          value: entry,
          label: entry,
          description: catalogMatch?.description || undefined,
        };
      });
  }, [globalServicesQuery.data?.rows, selectedInstitutionAdditionalServices, selectedInstitutionType]);
  const branchServiceOptions = useMemo(() => {
    const catalogRows = globalServicesQuery.data?.rows ?? [];
    const mergedNames = mergeGlobalServiceNames([
      ...catalogRows.map((entry) => entry.name),
      ...selectedBranchAdditionalServices,
    ]);
    return mergedNames
      .filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(selectedBranchType))
      .map((entry) => {
        const catalogMatch = catalogRows.find((row) => getGlobalServiceKey(row.name) === getGlobalServiceKey(entry));
        return {
          value: entry,
          label: entry,
          description: catalogMatch?.description || undefined,
        };
      });
  }, [globalServicesQuery.data?.rows, selectedBranchAdditionalServices, selectedBranchType]);
  const geoStatesQuery = useGeoStates();
  const geoStates = geoStatesQuery.data ?? [];

  const editSelectedStateName = editForm.watch('state') || '';
  const editSelectedLgaName = editForm.watch('lga') || '';
  const editSelectedState = geoStates.find((entry) => entry.name.toLowerCase() === editSelectedStateName.toLowerCase()) ?? null;
  const editLgasQuery = useGeoLgas({
    stateId: editSelectedState?.stateId,
    includeInactive: false,
    enabled: Boolean(editSelectedState?.stateId),
  });
  const editLgas = editLgasQuery.data ?? [];
  const editStateOptions = useMemo(() => {
    const options = geoStates.map((entry) => ({ value: entry.name, label: entry.name }));
    if (editSelectedStateName && !options.some((entry) => entry.value.toLowerCase() === editSelectedStateName.toLowerCase())) {
      options.unshift({ value: editSelectedStateName, label: editSelectedStateName });
    }
    return options;
  }, [geoStates, editSelectedStateName]);
  const editLgaOptions = useMemo(() => {
    const options = editLgas.map((entry) => ({ value: entry.name, label: entry.name }));
    if (editSelectedLgaName && !options.some((entry) => entry.value.toLowerCase() === editSelectedLgaName.toLowerCase())) {
      options.unshift({ value: editSelectedLgaName, label: editSelectedLgaName });
    }
    return options;
  }, [editLgas, editSelectedLgaName]);

  const branchSelectedStateName = branchForm.watch('state') || '';
  const branchSelectedLgaName = branchForm.watch('lga') || '';
  const branchSelectedState = geoStates.find((entry) => entry.name.toLowerCase() === branchSelectedStateName.toLowerCase()) ?? null;
  const branchLgasQuery = useGeoLgas({
    stateId: branchSelectedState?.stateId,
    includeInactive: false,
    enabled: Boolean(branchSelectedState?.stateId),
  });
  const branchLgas = branchLgasQuery.data ?? [];
  const branchStateOptions = useMemo(() => {
    const options = geoStates.map((entry) => ({ value: entry.name, label: entry.name }));
    if (branchSelectedStateName && !options.some((entry) => entry.value.toLowerCase() === branchSelectedStateName.toLowerCase())) {
      options.unshift({ value: branchSelectedStateName, label: branchSelectedStateName });
    }
    return options;
  }, [branchSelectedStateName, geoStates]);
  const branchLgaOptions = useMemo(() => {
    const options = branchLgas.map((entry) => ({ value: entry.name, label: entry.name }));
    if (branchSelectedLgaName && !options.some((entry) => entry.value.toLowerCase() === branchSelectedLgaName.toLowerCase())) {
      options.unshift({ value: branchSelectedLgaName, label: branchSelectedLgaName });
    }
    return options;
  }, [branchLgas, branchSelectedLgaName]);

  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);

  if (!institutionId) return <ErrorState title="Institution not found" description="Invalid institution identifier." />;
  if (detailsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <LoadingSkeleton className="h-8 w-64" />
          <LoadingSkeleton className="h-4 w-80" />
        </div>
        <div className="rounded-xl border border-border p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <LoadingSkeleton className="h-3 w-20" />
                <LoadingSkeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border p-6 space-y-3">
          <LoadingSkeleton className="h-5 w-40" />
          <LoadingSkeleton className="h-4 w-full" />
          <LoadingSkeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }
  if (detailsQuery.isError) return <ErrorState title="Unable to load institution details" description="Retry loading institution profile." onRetry={() => detailsQuery.refetch()} />;
  if (!institution) return <EmptyState title="Institution not found" description="You may not have access to this institution." />;
  if (inOrganizationContext && contextOrganizationId && institution.organizationId !== contextOrganizationId) {
    return (
      <ErrorState
        title="Institution not in active organization context"
        description="Switch to the correct organization context to manage this institution."
        onRetry={() => navigate(`/app/institutions?orgId=${encodeURIComponent(contextOrganizationId)}`)}
      />
    );
  }

  const onEditSubmit = editForm.handleSubmit(async (values) => {
    if (!orgId) return;
    await updateInstitution.mutateAsync({
      orgId,
      institutionId: institution.institutionId,
      name: values.name,
      code: values.code || undefined,
      type: values.type as never,
      status: values.status as 'active' | 'inactive' | 'suspended',
      description: values.description || undefined,
      metadata: {
        additionalServices: mergeGlobalServiceNames(values.additionalServices),
        openingHours: values.openingHours || undefined,
      },
      address: {
        line1: values.addressLine1 || undefined,
        city: values.city || undefined,
        state: values.state || undefined,
        lga: values.lga || undefined,
        postalCode: values.postalCode || undefined,
        country: 'Nigeria',
      },
      location: { state: values.state || undefined, lga: values.lga || undefined },
      contact: {
        phone: values.phone || undefined,
        email: values.email || undefined,
      },
    });
    setEditOpen(false);
  });

  const onUploadDocuments = async () => {
    if (!orgId || documentFiles.length === 0) return;
    await uploadInstitutionFiles.mutateAsync({
      orgId,
      institutionId: institution.institutionId,
      files: documentFiles,
    });
    setDocumentFiles([]);
  };

  const organizationDisplayName = institution.organizationName || institution.organizationId;
  const address = (institution.address as Record<string, unknown> | null) || null;
  const contact = (institution.contact as Record<string, unknown> | null) || null;
  const documents = institution.documents ?? [];

  const onCreateBranch = branchForm.handleSubmit(async (values) => {
    if (!orgId) return;
    const normalizedAdditionalServices = mergeGlobalServiceNames(values.additionalServices);
    const capabilities = Array.from(new Set(
      normalizedAdditionalServices
        .map((entry) => getGlobalServiceKey(entry))
        .filter((entry): entry is BranchType =>
          ['hospital', 'clinic', 'laboratory', 'pharmacy'].includes(entry)
          && entry !== values.type,
        ),
    ));
    await createBranch.mutateAsync({
      orgId,
      institutionId: institution.institutionId,
      name: values.name,
      code: values.code,
      type: values.type,
      ...(capabilities.length > 0 ? { capabilities } : {}),
      metadata: {
        additionalServices: normalizedAdditionalServices,
        openingHours: values.openingHours || undefined,
      },
      address: {
        line1: values.addressLine1 || undefined,
        postalCode: values.postalCode || undefined,
      },
      contact: {
        phone: values.phone || undefined,
        email: values.email || undefined,
      },
      location: { state: values.state || undefined, lga: values.lga || undefined },
    });
    setBranchOpen(false);
    branchForm.reset({
      name: '',
      code: '',
      type: 'hospital',
      additionalServices: [],
      openingHours: '',
      addressLine1: '',
      postalCode: '',
      phone: '',
      email: '',
      state: '',
      lga: '',
    });
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
            {canCreateBranch ? (
              <Button
                onClick={() => {
                  branchForm.reset({
                    name: '',
                    code: '',
                    type: institution.type && ['hospital', 'clinic', 'laboratory', 'pharmacy'].includes(institution.type)
                      ? institution.type as BranchType
                      : 'hospital',
                    additionalServices: [],
                    openingHours: '',
                    addressLine1: '',
                    postalCode: '',
                    phone: '',
                    email: '',
                    state: institution.state !== 'N/A' ? institution.state : '',
                    lga: institution.lga !== 'N/A' ? institution.lga : '',
                  });
                  setBranchOpen(true);
                }}
              >
                Create Branch
              </Button>
            ) : null}
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
          <div><p className="text-xs text-muted">Organization</p><p className="text-sm text-foreground">{organizationDisplayName}</p></div>
          <div><p className="text-xs text-muted">Type</p><p className="text-sm text-foreground">{cap(institution.type)}</p></div>
          <div><p className="text-xs text-muted">Code</p><p className="text-sm text-foreground">{institution.code}</p></div>
          <div className="md:col-span-2 xl:col-span-4"><p className="text-xs text-muted">Additional Services</p><p className="text-sm text-foreground">{institution.additionalServices.join(', ') || 'N/A'}</p></div>
          <div className="md:col-span-2 xl:col-span-4"><p className="text-xs text-muted">Opening Hours</p><p className="text-sm text-foreground whitespace-pre-wrap">{institution.openingHours || 'N/A'}</p></div>
          <div className="xl:col-span-2"><p className="text-xs text-muted">Address</p><p className="text-sm text-foreground">{String(address?.line1 || address?.addressText || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">City</p><p className="text-sm text-foreground">{String(address?.city || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">State</p><p className="text-sm text-foreground">{institution.state}</p></div>
          <div><p className="text-xs text-muted">LGA</p><p className="text-sm text-foreground">{institution.lga}</p></div>
          <div><p className="text-xs text-muted">Postal Code</p><p className="text-sm text-foreground">{String(address?.postalCode || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">Phone</p><p className="text-sm text-foreground">{String(contact?.phone || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">Email</p><p className="text-sm text-foreground">{String(contact?.email || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">HQ</p><p className="text-sm text-foreground">{institution.isHeadquarters ? 'Yes' : 'No'}</p></div>
          <div className="md:col-span-2 xl:col-span-4"><p className="text-xs text-muted">Description</p><p className="text-sm text-foreground">{institution.description || 'No description'}</p></div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Government Documents</CardTitle>
          <CardDescription>Upload and manage institution supporting documents.</CardDescription>
        </CardHeader>
        <div className="space-y-4 p-6 pt-0">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => setDocumentFiles(Array.from(event.target.files || []))}
            />
            <Button
              type="button"
              onClick={onUploadDocuments}
              disabled={documentFiles.length === 0}
              loading={uploadInstitutionFiles.isPending}
            >
              Upload Documents
            </Button>
          </div>
          <p className="text-xs text-muted">{documentFiles.length} file(s) selected</p>
          <div className="space-y-2">
            {documents.length === 0 ? <p className="text-sm text-muted">No institution documents uploaded yet.</p> : null}
            {documents.map((doc) => (
              <a
                key={doc.documentId}
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:bg-muted/30"
              >
                <span className="truncate">{doc.title || doc.type || 'Document'}</span>
                <span className="text-xs text-muted">{new Date(doc.uploadedAt).toLocaleDateString()}</span>
              </a>
            ))}
          </div>
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
          <FormField label="Description"><Input {...editForm.register('description')} /></FormField>
          <FormField label="Additional Services">
            <GlobalServicesSelector
              options={institutionServiceOptions}
              values={selectedInstitutionAdditionalServices}
              excludeValue={selectedInstitutionType}
              entityLabel="institution"
              onChange={(next) => editForm.setValue('additionalServices', next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <FormField label="Opening Hours / More Details">
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="Example: Monday to Friday, 6:00 AM to 8:00 PM. Saturdays, 8:00 AM to 2:00 PM."
              {...editForm.register('openingHours')}
            />
          </FormField>
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
            <FormField label="Address Line"><Input {...editForm.register('addressLine1')} /></FormField>
            <FormField label="City / Town"><Input {...editForm.register('city')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State">
              <SmartSelect
                value={editForm.watch('state') || null}
                onChange={(next) => {
                  editForm.setValue('state', next, { shouldDirty: true, shouldValidate: true });
                  editForm.setValue('lga', '', { shouldDirty: true, shouldValidate: true });
                }}
                placeholder={geoStatesQuery.isLoading ? 'Loading states...' : 'Select state'}
                debounceMs={200}
                loadOptions={async (input) =>
                  editStateOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </FormField>
            <FormField label="LGA">
              {editSelectedState ? (
                <SmartSelect
                  value={editForm.watch('lga') || null}
                  onChange={(next) => editForm.setValue('lga', next, { shouldDirty: true, shouldValidate: true })}
                  placeholder={editLgasQuery.isLoading ? 'Loading LGAs...' : 'Select LGA'}
                  debounceMs={200}
                  loadOptions={async (input) =>
                    editLgaOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                  }
                />
              ) : (
                <Input value="" readOnly placeholder="Select state first" />
              )}
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Postal Code"><Input {...editForm.register('postalCode')} /></FormField>
            <FormField label="Phone"><Input {...editForm.register('phone')} /></FormField>
            <FormField label="Email"><Input type="email" {...editForm.register('email')} /></FormField>
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
            <FormField label="Organization">
              <Input value={organizationDisplayName} readOnly />
            </FormField>
            <FormField label="Institution">
              <Input value={institution.name} readOnly />
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Branch Name"><Input {...branchForm.register('name')} /></FormField>
            <FormField label="Code"><Input {...branchForm.register('code')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Type">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...branchForm.register('type')}>
                {branchTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Address Line"><Input {...branchForm.register('addressLine1')} /></FormField>
            <FormField label="Postal Code"><Input {...branchForm.register('postalCode')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Phone"><Input {...branchForm.register('phone')} /></FormField>
            <FormField label="Email"><Input type="email" {...branchForm.register('email')} /></FormField>
          </div>
          <FormField label="Opening Hours / More Details">
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="Example: Monday to Friday, 6:00 AM to 8:00 PM. Saturdays, 8:00 AM to 2:00 PM."
              {...branchForm.register('openingHours')}
            />
          </FormField>
          <FormField label="Additional Services In This Branch">
            <GlobalServicesSelector
              options={branchServiceOptions}
              values={selectedBranchAdditionalServices}
              excludeValue={selectedBranchType}
              entityLabel="branch"
              onChange={(next) => branchForm.setValue('additionalServices', next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State">
              <SmartSelect
                value={branchForm.watch('state') || null}
                onChange={(next) => {
                  branchForm.setValue('state', next, { shouldDirty: true, shouldValidate: true });
                  branchForm.setValue('lga', '', { shouldDirty: true, shouldValidate: true });
                }}
                placeholder={geoStatesQuery.isLoading ? 'Loading states...' : 'Select state'}
                debounceMs={200}
                loadOptions={async (input) =>
                  branchStateOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </FormField>
            <FormField label="LGA">
              {branchSelectedState ? (
                <SmartSelect
                  value={branchForm.watch('lga') || null}
                  onChange={(next) => branchForm.setValue('lga', next, { shouldDirty: true, shouldValidate: true })}
                  placeholder={branchLgasQuery.isLoading ? 'Loading LGAs...' : 'Select LGA'}
                  debounceMs={200}
                  loadOptions={async (input) =>
                    branchLgaOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                  }
                />
              ) : (
                <Input value="" readOnly placeholder="Select state first" />
              )}
            </FormField>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setBranchOpen(false)}>Cancel</Button>
            <Button type="submit" loading={createBranch.isPending}>Create</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
