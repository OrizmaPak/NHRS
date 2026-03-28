import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { GlobalServicesSelector } from '@/components/forms/GlobalServicesSelector';
import { Input } from '@/components/ui/Input';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import {
  type InstitutionRow,
  type InstitutionType,
  useCreateOrgInstitution,
  useOrganizations,
  useScopedInstitutions,
  useUploadInstitutionFiles,
} from '@/api/hooks/useInstitutions';
import { useGeoLgas, useGeoStates } from '@/api/hooks/useGeography';
import { getGlobalServiceKey, mergeGlobalServiceNames, useGlobalServices } from '@/api/hooks/useGlobalServices';

const schema = z.object({
  orgId: z.string().min(1, 'Organization is required'),
  name: z.string().min(2),
  code: z.string().optional(),
  type: z.enum(['hospital', 'laboratory', 'pharmacy', 'clinic', 'government', 'emergency', 'catalog']),
  description: z.string().optional(),
  additionalServices: z.array(z.string()).default([]),
  openingHours: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default('Nigeria'),
  state: z.string().min(2, 'State is required'),
  lga: z.string().min(2, 'LGA is required'),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});
type Values = z.infer<typeof schema>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function extractInstitutionId(value: unknown): string | null {
  const root = asRecord(value);
  const institution = asRecord(root?.institution);
  const fromInstitution = institution?.institutionId;
  if (typeof fromInstitution === 'string' && fromInstitution.trim().length > 0) return fromInstitution;
  const fromRoot = root?.institutionId;
  if (typeof fromRoot === 'string' && fromRoot.trim().length > 0) return fromRoot;
  return null;
}

function cap(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function InstitutionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeContext = useContextStore((state) => state.activeContext);
  const contextOrganizationId = getOrganizationIdFromContext(activeContext);
  const inOrganizationContext = activeContext?.type === 'organization';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [modalOpen, setModalOpen] = useState(false);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);

  const queryOrgId = searchParams.get('orgId') || undefined;
  const orgId = contextOrganizationId || queryOrgId;

  const orgsQuery = useOrganizations({ page: 1, limit: 200 });
  const institutionsQuery = useScopedInstitutions({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    orgId,
    q: q || undefined,
    status: status || undefined,
    type: type || undefined,
  });
  const createInstitution = useCreateOrgInstitution();
  const uploadInstitutionFiles = useUploadInstitutionFiles();
  const globalServicesQuery = useGlobalServices({ limit: 500 });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      orgId: orgId || '',
      name: '',
      code: '',
      type: 'hospital',
      description: '',
      additionalServices: [],
      openingHours: '',
      addressLine1: '',
      city: '',
      country: 'Nigeria',
      state: '',
      lga: '',
      postalCode: '',
      phone: '',
      email: '',
    },
  });
  const selectedInstitutionType = form.watch('type');
  const selectedStateName = form.watch('state') || '';
  const selectedLgaName = form.watch('lga') || '';
  const selectedAdditionalServices = form.watch('additionalServices') || [];
  const globalServiceOptions = useMemo(() => {
    const catalogRows = globalServicesQuery.data?.rows ?? [];
    const mergedNames = mergeGlobalServiceNames([
      ...catalogRows.map((entry) => entry.name),
      ...selectedAdditionalServices,
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
  }, [globalServicesQuery.data?.rows, selectedAdditionalServices, selectedInstitutionType]);
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
    if (!orgId) return;
    form.setValue('orgId', orgId, { shouldDirty: false, shouldValidate: true });
  }, [form, orgId]);

  const orgOptions = (orgsQuery.data?.rows ?? []).map((entry) => ({
    value: entry.organizationId,
    label: entry.name,
  }));
  const orgNameById = useMemo(
    () => new Map((orgsQuery.data?.rows ?? []).map((entry) => [entry.organizationId, entry.name])),
    [orgsQuery.data?.rows],
  );
  const activeOrganizationName = inOrganizationContext ? String(activeContext?.name || '').trim() : '';

  const columns = useMemo<ColumnDef<InstitutionRow>[]>(() => [
    { accessorKey: 'name', header: 'Institution' },
    {
      accessorKey: 'organizationId',
      header: 'Organization',
      cell: ({ row }) => row.original.organizationName || orgNameById.get(row.original.organizationId) || row.original.organizationId,
    },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => cap(row.original.type) },
    { accessorKey: 'state', header: 'State' },
    { accessorKey: 'lga', header: 'LGA' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Button asChild size="sm" variant="outline">
          <Link to={`/app/institutions/${row.original.institutionId}`}>View</Link>
        </Button>
      ),
    },
  ], [orgNameById]);

  const onSubmit = form.handleSubmit(async (values) => {
    const created = await createInstitution.mutateAsync({
      orgId: values.orgId,
      name: values.name,
      code: values.code || undefined,
      type: values.type as InstitutionType,
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
        country: values.country || 'Nigeria',
      },
      location: {
        state: values.state || undefined,
        lga: values.lga || undefined,
      },
      contact: {
        phone: values.phone || undefined,
        email: values.email || undefined,
      },
    });

    const createdInstitutionId = extractInstitutionId(created);
    if (values.orgId && createdInstitutionId && documentFiles.length > 0) {
      await uploadInstitutionFiles.mutateAsync({
        orgId: values.orgId,
        institutionId: createdInstitutionId,
        files: documentFiles,
      });
    }

    setModalOpen(false);
    setDocumentFiles([]);
    form.reset({
      orgId: values.orgId,
      name: '',
      code: '',
      type: 'hospital',
      description: '',
      additionalServices: [],
      openingHours: '',
      addressLine1: '',
      city: '',
      state: '',
      lga: '',
      postalCode: '',
      phone: '',
      email: '',
    });
  });

  if (inOrganizationContext && !contextOrganizationId) {
    return (
      <ErrorState
        title="Organization context required"
        description="Switch to a valid organization context to view institution workspace."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institutions"
        description="Institution workspace is separate from organization and branch workspaces."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Institutions' }]}
        actions={(
          <PermissionGate permission="org.branch.create">
            <Button
              onClick={() => {
                form.reset({
                  orgId: orgId || '',
                  name: '',
                  code: '',
                  type: 'hospital',
                  description: '',
                  additionalServices: [],
                  openingHours: '',
                  addressLine1: '',
                  city: '',
                  country: 'Nigeria',
                  state: '',
                  lga: '',
                  postalCode: '',
                  phone: '',
                  email: '',
                });
                setDocumentFiles([]);
                setModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Create Institution
            </Button>
          </PermissionGate>
        )}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search institutions" />
        </div>
        <div className="w-full md:max-w-sm">
          {inOrganizationContext ? (
            <Input value={activeOrganizationName || orgNameById.get(orgId || '') || orgId || ''} readOnly />
          ) : (
            <SmartSelect
              value={orgId || null}
              onChange={(value) => {
                const next = new URLSearchParams(searchParams);
                if (value) next.set('orgId', value);
                else next.delete('orgId');
                setSearchParams(next);
              }}
              placeholder="Organization scope"
              loadOptions={async (input) =>
                orgOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
          )}
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={status}
            onChange={setStatus}
            placeholder="Status"
            loadOptions={async (input) =>
              ['active', 'inactive', 'suspended']
                .filter((entry) => entry.includes(input.toLowerCase()))
                .map((entry) => ({ value: entry, label: cap(entry) }))
            }
          />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={type}
            onChange={setType}
            placeholder="Type"
            loadOptions={async (input) =>
              ['hospital', 'laboratory', 'pharmacy', 'clinic', 'government', 'emergency', 'catalog']
                .filter((entry) => entry.includes(input.toLowerCase()))
                .map((entry) => ({ value: entry, label: cap(entry) }))
            }
          />
        </div>
      </FilterBar>

      {institutionsQuery.isError ? (
        <ErrorState title="Unable to load institutions" description="Retry loading institution records." onRetry={() => institutionsQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={institutionsQuery.data?.rows ?? []}
          total={institutionsQuery.data?.total ?? 0}
          loading={institutionsQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((institutionsQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title="Create Institution">
        <form className="space-y-3" onSubmit={onSubmit}>
          <input type="hidden" {...form.register('country')} value={form.watch('country') || 'Nigeria'} />
          <FormField label="Organization">
            {inOrganizationContext ? (
              <Input value={activeOrganizationName || orgNameById.get(orgId || '') || orgId || ''} readOnly />
            ) : (
              <SmartSelect
                value={form.watch('orgId') || null}
                onChange={(next) => form.setValue('orgId', next || '', { shouldDirty: true, shouldValidate: true })}
                placeholder="Select organization"
                loadOptions={async (input) =>
                  orgOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            )}
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Name"><Input {...form.register('name')} /></FormField>
            <FormField label="Code"><Input {...form.register('code')} /></FormField>
          </div>
          <FormField label="Description"><Input {...form.register('description')} /></FormField>
          <FormField label="Additional Services In This Institution">
            <GlobalServicesSelector
              options={globalServiceOptions}
              values={selectedAdditionalServices}
              excludeValue={selectedInstitutionType}
              entityLabel="institution"
              onChange={(next) => form.setValue('additionalServices', next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <FormField label="Opening Hours / More Details">
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="Example: Monday to Friday, 6:00 AM to 8:00 PM. Saturdays, 8:00 AM to 2:00 PM."
              {...form.register('openingHours')}
            />
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Type">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...form.register('type')}>
                <option value="hospital">Hospital</option>
                <option value="laboratory">Laboratory</option>
                <option value="pharmacy">Pharmacy</option>
                <option value="clinic">Clinic</option>
                <option value="government">Government</option>
                <option value="emergency">Emergency</option>
                <option value="catalog">Catalog</option>
              </select>
            </FormField>
            <FormField label="Address Line"><Input {...form.register('addressLine1')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="City / Town"><Input {...form.register('city')} /></FormField>
            <FormField label="State">
              <select
                className="h-10 w-full rounded-md border border-border px-3 text-sm"
                value={form.watch('state') || ''}
                disabled={geoStatesQuery.isLoading}
                onChange={(event) => {
                  form.setValue('state', event.target.value, { shouldDirty: true, shouldValidate: true });
                  form.setValue('lga', '', { shouldDirty: true, shouldValidate: true });
                }}
              >
                <option value="">{geoStatesQuery.isLoading ? 'Loading Nigeria states...' : 'Select state'}</option>
                {stateOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="LGA">
              {selectedState ? (
                <select
                  className="h-10 w-full rounded-md border border-border px-3 text-sm"
                  value={form.watch('lga') || ''}
                  disabled={geoLgasQuery.isLoading}
                  onChange={(event) => form.setValue('lga', event.target.value, { shouldDirty: true, shouldValidate: true })}
                >
                  <option value="">{geoLgasQuery.isLoading ? 'Loading LGAs...' : 'Select LGA'}</option>
                  {lgaOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <Input value="" readOnly placeholder="Select state first" />
              )}
            </FormField>
            <FormField label="Postal Code"><Input {...form.register('postalCode')} /></FormField>
            <FormField label="Phone"><Input {...form.register('phone')} /></FormField>
          </div>
          <FormField label="Email"><Input type="email" {...form.register('email')} /></FormField>
          <FormField label="Government Documents (multiple)">
            <Input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                setDocumentFiles(files);
              }}
            />
            <p className="mt-1 text-xs text-muted">{documentFiles.length} file(s) selected</p>
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={createInstitution.isPending || uploadInstitutionFiles.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
