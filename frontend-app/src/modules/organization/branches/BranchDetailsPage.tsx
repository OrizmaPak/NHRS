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
import { GlobalServicesSelector } from '@/components/forms/GlobalServicesSelector';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import { type BranchType, useBranchById, useInstitutionById, useOrgDetails, useUpdateBranch } from '@/api/hooks/useInstitutions';
import { useGeoLgas, useGeoStates } from '@/api/hooks/useGeography';
import { getGlobalServiceKey, mergeGlobalServiceNames, useGlobalServices } from '@/api/hooks/useGlobalServices';

const schema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  type: z.enum(['hospital', 'clinic', 'laboratory', 'pharmacy']),
  status: z.string().optional(),
  additionalServices: z.array(z.string()).default([]),
  openingHours: z.string().optional(),
  addressLine1: z.string().optional(),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  state: z.string().min(2, 'State is required'),
  lga: z.string().min(2, 'LGA is required'),
});
type Values = z.infer<typeof schema>;

const branchTypeOptions: Array<{ value: BranchType; label: string }> = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
];

export function BranchDetailsPage() {
  const { branchId = '' } = useParams();
  const navigate = useNavigate();
  const activeContext = useContextStore((state) => state.activeContext);
  const contextOrganizationId = getOrganizationIdFromContext(activeContext);
  const inOrganizationContext = activeContext?.type === 'organization';
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const canEdit = hasPermission('org.branch.update');
  const [editOpen, setEditOpen] = useState(false);

  const detailsQuery = useBranchById(branchId);
  const updateBranch = useUpdateBranch();
  const globalServicesQuery = useGlobalServices({ limit: 500 });
  const branch = detailsQuery.data?.branch ?? null;
  const institutionQuery = useInstitutionById(branch?.institutionId);
  const organizationQuery = useOrgDetails(branch?.organizationId);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: branch?.name ?? '',
      code: branch?.code ?? '',
      type: branch?.type ?? branch?.capabilities[0] ?? 'hospital',
      status: branch?.status ?? 'active',
      additionalServices: branch?.additionalServices.filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(branch?.type)) ?? [],
      openingHours: branch?.openingHours ?? '',
      addressLine1: String((branch?.address as Record<string, unknown> | null)?.line1 ?? ''),
      postalCode: String((branch?.address as Record<string, unknown> | null)?.postalCode ?? ''),
      phone: String((branch?.contact as Record<string, unknown> | null)?.phone ?? ''),
      email: String((branch?.contact as Record<string, unknown> | null)?.email ?? ''),
      state: branch?.state === 'N/A' ? '' : branch?.state ?? '',
      lga: branch?.lga === 'N/A' ? '' : branch?.lga ?? '',
    },
  });
  const selectedType = form.watch('type');
  const selectedAdditionalServices = form.watch('additionalServices') || [];
  const globalServiceOptions = (globalServicesQuery.data?.rows ?? [])
    .map((entry) => ({ value: entry.name, label: entry.name }))
    .concat(
      mergeGlobalServiceNames(selectedAdditionalServices)
        .filter((entry) => !(globalServicesQuery.data?.rows ?? []).some((row) => getGlobalServiceKey(row.name) === getGlobalServiceKey(entry)))
        .map((entry) => ({ value: entry, label: entry })),
    )
    .filter((entry, index, all) =>
      getGlobalServiceKey(entry.value) !== getGlobalServiceKey(selectedType)
      && all.findIndex((candidate) => getGlobalServiceKey(candidate.value) === getGlobalServiceKey(entry.value)) === index,
    );
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
  const stateOptions = geoStates.map((entry) => ({ value: entry.name, label: entry.name }));
  if (selectedStateName && !stateOptions.some((entry) => entry.value.toLowerCase() === selectedStateName.toLowerCase())) {
    stateOptions.unshift({ value: selectedStateName, label: selectedStateName });
  }
  const lgaOptions = geoLgas.map((entry) => ({ value: entry.name, label: entry.name }));
  if (selectedLgaName && !lgaOptions.some((entry) => entry.value.toLowerCase() === selectedLgaName.toLowerCase())) {
    lgaOptions.unshift({ value: selectedLgaName, label: selectedLgaName });
  }

  if (!branchId) return <ErrorState title="Branch not found" description="Invalid branch identifier." />;
  if (detailsQuery.isError) return <ErrorState title="Unable to load branch details" description="Retry loading branch profile." onRetry={() => detailsQuery.refetch()} />;
  if (!branch) return <EmptyState title="Branch not found" description="You may not have access to this branch." />;
  if (inOrganizationContext && contextOrganizationId && branch.organizationId !== contextOrganizationId) {
    return (
      <ErrorState
        title="Branch not in active organization context"
        description="Switch to the correct organization context to manage this branch."
        onRetry={() => navigate(`/app/branches?orgId=${encodeURIComponent(contextOrganizationId)}`)}
      />
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const normalizedAdditionalServices = mergeGlobalServiceNames(values.additionalServices);
    const capabilities = Array.from(new Set(
      normalizedAdditionalServices
        .map((entry) => getGlobalServiceKey(entry))
        .filter((entry): entry is BranchType =>
          ['hospital', 'clinic', 'laboratory', 'pharmacy'].includes(entry)
          && entry !== values.type,
        ),
    ));
    await updateBranch.mutateAsync({
      orgId: branch.organizationId,
      institutionId: branch.institutionId,
      branchId: branch.branchId,
      name: values.name,
      code: values.code,
      type: values.type,
      status: values.status as 'active' | 'closed' | 'suspended',
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
      location: {
        state: values.state || undefined,
        lga: values.lga || undefined,
      },
    });
    setEditOpen(false);
  });

  const organizationName =
    branch.organizationName
    || organizationQuery.data?.organization?.name
    || (branch.organizationId === contextOrganizationId && activeContext?.name ? activeContext.name : '')
    || 'Organization';
  const institutionName =
    branch.institutionName
    || institutionQuery.data?.institution?.name
    || 'Institution';
  const branchAddress = (branch.address as Record<string, unknown> | null) || null;
  const branchContact = (branch.contact as Record<string, unknown> | null) || null;

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
          <div><p className="text-xs text-muted">Organization</p><p className="text-sm text-foreground">{organizationName}</p></div>
          <div><p className="text-xs text-muted">Institution</p><p className="text-sm text-foreground">{institutionName}</p></div>
          <div><p className="text-xs text-muted">Code</p><p className="text-sm text-foreground">{branch.code}</p></div>
          <div><p className="text-xs text-muted">Type</p><p className="text-sm text-foreground">{cap(branch.type || branch.capabilities[0] || 'N/A')}</p></div>
          <div className="md:col-span-2 xl:col-span-4"><p className="text-xs text-muted">Additional Services</p><p className="text-sm text-foreground">{branch.additionalServices.filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(branch.type)).join(', ') || 'N/A'}</p></div>
          <div className="md:col-span-2 xl:col-span-4"><p className="text-xs text-muted">Opening Hours</p><p className="text-sm text-foreground whitespace-pre-wrap">{branch.openingHours || 'N/A'}</p></div>
          <div><p className="text-xs text-muted">Address Line</p><p className="text-sm text-foreground">{String(branchAddress?.line1 || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">Postal Code</p><p className="text-sm text-foreground">{String(branchAddress?.postalCode || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">Phone</p><p className="text-sm text-foreground">{String(branchContact?.phone || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">Email</p><p className="text-sm text-foreground">{String(branchContact?.email || 'N/A')}</p></div>
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
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Type">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...form.register('type')}>
                {branchTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Address Line"><Input {...form.register('addressLine1')} /></FormField>
            <FormField label="Postal Code"><Input {...form.register('postalCode')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Phone"><Input {...form.register('phone')} /></FormField>
            <FormField label="Email"><Input type="email" {...form.register('email')} /></FormField>
          </div>
          <FormField label="Opening Hours / More Details">
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="Example: Monday to Friday, 6:00 AM to 8:00 PM. Saturdays, 8:00 AM to 2:00 PM."
              {...form.register('openingHours')}
            />
          </FormField>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Additional Services">
              <GlobalServicesSelector
                options={globalServiceOptions}
                values={selectedAdditionalServices}
                excludeValue={selectedType}
                entityLabel="branch"
                onChange={(next) => form.setValue('additionalServices', next, { shouldDirty: true, shouldValidate: true })}
              />
            </FormField>
            <FormField label="Status">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...form.register('status')}>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="suspended">Suspended</option>
              </select>
            </FormField>
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
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={updateBranch.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
