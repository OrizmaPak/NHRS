import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { GlobalServicesSelector } from '@/components/forms/GlobalServicesSelector';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import { type BranchRow, type BranchType, useCreateBranch, useInstitutionById, useOrganizations, useOrgDetails, useScopedBranches, useScopedInstitutions } from '@/api/hooks/useInstitutions';
import { useGeoLgas, useGeoStates } from '@/api/hooks/useGeography';
import { getGlobalServiceKey, mergeGlobalServiceNames, useGlobalServices } from '@/api/hooks/useGlobalServices';

function cap(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const createBranchSchema = z.object({
  institutionId: z.string().min(1, 'Institution is required'),
  name: z.string().min(2, 'Branch name is required'),
  code: z.string().min(2, 'Code is required'),
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

type CreateBranchValues = z.infer<typeof createBranchSchema>;

const branchTypeOptions: Array<{ value: BranchType; label: string }> = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
];

export function BranchesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeContext = useContextStore((state) => state.activeContext);
  const contextOrganizationId = getOrganizationIdFromContext(activeContext);
  const inOrganizationContext = activeContext?.type === 'organization';
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const canCreateBranch = hasPermission('org.branch.create');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [showCreateModal, setShowCreateModal] = useState(false);

  const queryOrgId = searchParams.get('orgId') || undefined;
  const orgId = contextOrganizationId || queryOrgId;
  const institutionId = searchParams.get('institutionId') || undefined;

  const orgsQuery = useOrganizations({ page: 1, limit: 200 });
  const orgDetailsQuery = useOrgDetails(orgId);
  const institutionsQuery = useScopedInstitutions({ page: 1, limit: 200, orgId });
  const selectedInstitutionQuery = useInstitutionById(institutionId);
  const branchesQuery = useScopedBranches({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    orgId,
    institutionId,
    q: q || undefined,
    status: status || undefined,
  });
  const createBranch = useCreateBranch();
  const globalServicesQuery = useGlobalServices({ limit: 500 });
  const geoStatesQuery = useGeoStates();
  const geoStates = geoStatesQuery.data ?? [];

  const orgOptions = (orgsQuery.data?.rows ?? []).map((entry) => ({ value: entry.organizationId, label: entry.name }));
  const selectedInstitutionDisplayName = selectedInstitutionQuery.data?.institution?.name || '';
  const institutionOptions = useMemo(() => {
    const options = (institutionsQuery.data?.rows ?? []).map((entry) => ({
      value: entry.institutionId,
      label: entry.name,
      description: entry.code || undefined,
    }));
    if (institutionId && selectedInstitutionDisplayName && !options.some((entry) => entry.value === institutionId)) {
      options.unshift({
        value: institutionId,
        label: selectedInstitutionDisplayName,
        description: selectedInstitutionQuery.data?.institution?.code || undefined,
      });
    }
    return options;
  }, [institutionId, institutionsQuery.data?.rows, selectedInstitutionDisplayName, selectedInstitutionQuery.data?.institution?.code]);
  const orgNameById = useMemo(
    () => new Map((orgsQuery.data?.rows ?? []).map((entry) => [entry.organizationId, entry.name])),
    [orgsQuery.data?.rows],
  );
  const institutionNameById = useMemo(
    () => new Map(institutionOptions.map((entry) => [entry.value, entry.label])),
    [institutionOptions],
  );
  const organizationDisplayName = orgDetailsQuery.data?.organization?.name
    || orgNameById.get(orgId ?? '')
    || (activeContext?.name && activeContext.type === 'organization' ? activeContext.name : '')
    || '';
  const resolvedInstitutionDisplayName = selectedInstitutionDisplayName
    || institutionNameById.get(institutionId ?? '')
    || '';

  const createForm = useForm<CreateBranchValues>({
    resolver: zodResolver(createBranchSchema),
    defaultValues: {
      institutionId: institutionId ?? '',
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
  const selectedCreateType = createForm.watch('type');
  const selectedCreateAdditionalServices = createForm.watch('additionalServices') || [];
  const globalServiceOptions = useMemo(() => {
    const catalogRows = globalServicesQuery.data?.rows ?? [];
    const mergedNames = mergeGlobalServiceNames([
      ...catalogRows.map((entry) => entry.name),
      ...selectedCreateAdditionalServices,
    ]);
    return mergedNames
      .filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(selectedCreateType))
      .map((entry) => {
        const catalogMatch = catalogRows.find((row) => getGlobalServiceKey(row.name) === getGlobalServiceKey(entry));
        return {
          value: entry,
          label: entry,
          description: catalogMatch?.description || undefined,
        };
      });
  }, [globalServicesQuery.data?.rows, selectedCreateAdditionalServices, selectedCreateType]);
  const selectedCreateStateName = createForm.watch('state') || '';
  const selectedCreateLgaName = createForm.watch('lga') || '';
  const selectedCreateState = geoStates.find((entry) => entry.name.toLowerCase() === selectedCreateStateName.toLowerCase()) ?? null;
  const createLgasQuery = useGeoLgas({
    stateId: selectedCreateState?.stateId,
    includeInactive: false,
    enabled: Boolean(selectedCreateState?.stateId),
  });
  const createStateOptions = useMemo(() => {
    const options = geoStates.map((entry) => ({ value: entry.name, label: entry.name }));
    if (selectedCreateStateName && !options.some((entry) => entry.value.toLowerCase() === selectedCreateStateName.toLowerCase())) {
      options.unshift({ value: selectedCreateStateName, label: selectedCreateStateName });
    }
    return options;
  }, [geoStates, selectedCreateStateName]);
  const createLgaOptions = useMemo(() => {
    const options = (createLgasQuery.data ?? []).map((entry) => ({ value: entry.name, label: entry.name }));
    if (selectedCreateLgaName && !options.some((entry) => entry.value.toLowerCase() === selectedCreateLgaName.toLowerCase())) {
      options.unshift({ value: selectedCreateLgaName, label: selectedCreateLgaName });
    }
    return options;
  }, [createLgasQuery.data, selectedCreateLgaName]);

  const columns = useMemo<ColumnDef<BranchRow>[]>(() => [
    { accessorKey: 'name', header: 'Branch' },
    {
      accessorKey: 'organizationId',
      header: 'Organization',
      cell: ({ row }) =>
        row.original.organizationName
        || orgNameById.get(row.original.organizationId)
        || (row.original.organizationId === orgId ? organizationDisplayName : '')
        || 'Organization',
    },
    {
      accessorKey: 'institutionId',
      header: 'Institution',
      cell: ({ row }) =>
        row.original.institutionName
        || institutionNameById.get(row.original.institutionId)
        || (row.original.institutionId === institutionId ? resolvedInstitutionDisplayName : '')
        || 'Institution',
    },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => cap(row.original.type || 'N/A') },
    {
      accessorKey: 'capabilities',
      header: 'Additional Services',
      cell: ({ row }) => row.original.additionalServices
        .filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(row.original.type))
        .join(', ') || 'N/A',
    },
    { accessorKey: 'state', header: 'State' },
    { accessorKey: 'lga', header: 'LGA' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Link to={`/app/branches/${row.original.branchId}`} className="text-sm font-medium text-primary hover:underline">
          View
        </Link>
      ),
    },
  ], [institutionId, institutionNameById, orgId, orgNameById, organizationDisplayName, resolvedInstitutionDisplayName]);

  const openCreateModal = () => {
    const selectedInstitution = selectedInstitutionQuery.data?.institution ?? null;
    createForm.reset({
      institutionId: institutionId ?? '',
      name: '',
      code: '',
      type: selectedInstitution?.type && ['hospital', 'clinic', 'laboratory', 'pharmacy'].includes(selectedInstitution.type)
        ? selectedInstitution.type as BranchType
        : 'hospital',
      additionalServices: [],
      openingHours: '',
      addressLine1: '',
      postalCode: '',
      phone: '',
      email: '',
      state: selectedInstitution?.state && selectedInstitution.state !== 'N/A' ? selectedInstitution.state : '',
      lga: selectedInstitution?.lga && selectedInstitution.lga !== 'N/A' ? selectedInstitution.lga : '',
    });
    setShowCreateModal(true);
  };

  const onCreateBranch = createForm.handleSubmit(async (values) => {
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
      institutionId: values.institutionId,
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
      location: {
        state: values.state || undefined,
        lga: values.lga || undefined,
      },
    });

    setShowCreateModal(false);
  });

  if (inOrganizationContext && !contextOrganizationId) {
    return (
      <ErrorState
        title="Organization context required"
        description="Switch to a valid organization context to view branch workspace."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="Standalone branch workspace. Filter by organization or institution scope."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Branches' }]}
        actions={canCreateBranch ? (
          <Button onClick={openCreateModal} disabled={!orgId}>
            Create Branch
          </Button>
        ) : undefined}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search branches" />
        </div>
        <div className="w-full md:max-w-sm">
          {inOrganizationContext ? (
            <Input value={organizationDisplayName} readOnly />
          ) : (
            <SmartSelect
              value={orgId || null}
              onChange={(value) => {
                const next = new URLSearchParams(searchParams);
                if (value) next.set('orgId', value);
                else next.delete('orgId');
                next.delete('institutionId');
                setSearchParams(next);
              }}
              placeholder="Organization"
              loadOptions={async (input) =>
                orgOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
          )}
        </div>
        <div className="w-full md:max-w-sm">
          <SmartSelect
            value={institutionId || null}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value) next.set('institutionId', value);
              else next.delete('institutionId');
              setSearchParams(next);
            }}
            placeholder="Institution"
            loadOptions={async (input) =>
              institutionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
            }
          />
        </div>
        <div className="w-full md:max-w-xs">
          <SmartSelect
            value={status}
            onChange={setStatus}
            placeholder="Status"
            loadOptions={async (input) =>
              ['active', 'closed', 'suspended']
                .filter((entry) => entry.includes(input.toLowerCase()))
                .map((entry) => ({ value: entry, label: cap(entry) }))
            }
          />
        </div>
      </FilterBar>

      {branchesQuery.isError ? (
        <ErrorState title="Unable to load branches" description="Retry loading branch records." onRetry={() => branchesQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={branchesQuery.data?.rows ?? []}
          total={branchesQuery.data?.total ?? 0}
          loading={branchesQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((branchesQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}

      <Modal open={showCreateModal} onOpenChange={setShowCreateModal} title="Create Branch">
        <form className="space-y-3" onSubmit={onCreateBranch}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Organization">
              <Input value={organizationDisplayName} readOnly />
            </FormField>
            <FormField label="Institution">
              <SmartSelect
                value={createForm.watch('institutionId') || null}
                onChange={(value) => createForm.setValue('institutionId', value, { shouldDirty: true, shouldValidate: true })}
                placeholder="Select institution"
                debounceMs={200}
                loadOptions={async (input) =>
                  institutionOptions.filter((entry) =>
                    `${entry.label} ${entry.description ?? ''}`.toLowerCase().includes(input.toLowerCase()),
                  )
                }
              />
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Branch Name"><Input {...createForm.register('name')} /></FormField>
            <FormField label="Code"><Input {...createForm.register('code')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Type">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...createForm.register('type')}>
                {branchTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Address Line"><Input {...createForm.register('addressLine1')} /></FormField>
            <FormField label="Postal Code"><Input {...createForm.register('postalCode')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Phone"><Input {...createForm.register('phone')} /></FormField>
            <FormField label="Email"><Input type="email" {...createForm.register('email')} /></FormField>
          </div>
          <FormField label="Opening Hours / More Details">
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="Example: Monday to Friday, 6:00 AM to 8:00 PM. Saturdays, 8:00 AM to 2:00 PM."
              {...createForm.register('openingHours')}
            />
          </FormField>
          <FormField label="Additional Services In This Branch">
            <GlobalServicesSelector
              options={globalServiceOptions}
              values={selectedCreateAdditionalServices}
              excludeValue={selectedCreateType}
              entityLabel="branch"
              onChange={(next) => createForm.setValue('additionalServices', next, { shouldDirty: true, shouldValidate: true })}
            />
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State">
              <SmartSelect
                value={createForm.watch('state') || null}
                onChange={(value) => {
                  createForm.setValue('state', value, { shouldDirty: true, shouldValidate: true });
                  createForm.setValue('lga', '', { shouldDirty: true, shouldValidate: true });
                }}
                placeholder={geoStatesQuery.isLoading ? 'Loading states...' : 'Select state'}
                debounceMs={200}
                loadOptions={async (input) =>
                  createStateOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </FormField>
            <FormField label="LGA">
              {selectedCreateState ? (
                <SmartSelect
                  value={createForm.watch('lga') || null}
                  onChange={(value) => createForm.setValue('lga', value, { shouldDirty: true, shouldValidate: true })}
                  placeholder={createLgasQuery.isLoading ? 'Loading LGAs...' : 'Select LGA'}
                  debounceMs={200}
                  loadOptions={async (input) =>
                    createLgaOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                  }
                />
              ) : (
                <Input value="" readOnly placeholder="Select state first" />
              )}
            </FormField>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button type="submit" loading={createBranch.isPending}>Create</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
