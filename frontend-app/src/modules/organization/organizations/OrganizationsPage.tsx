import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  History,
  LayoutGrid,
  List,
  Plus,
  UserCog,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/forms/FormField';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import {
  type OrganizationRow,
  useCreateOrganization,
  useOrgDetails,
  useOrganizations,
  useRequestOrganizationDeletion,
  useUploadOrganizationFile,
  useUpdateOrganization,
} from '@/api/hooks/useInstitutions';
import { useGeoLgas, useGeoStates } from '@/api/hooks/useGeography';

const orgSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  description: z.string().optional(),
  registrationNumber: z.string().optional(),
  ownerType: z.string().optional(),
  foundedAt: z.string().optional(),
  openedAt: z.string().optional(),
  website: z.string().optional(),
  state: z.string().min(2, 'State is required'),
  lga: z.string().min(2, 'Local government is required'),
  ownerUserId: z.string().optional(),
  ownerNin: z.string().regex(/^\d{11}$/, 'Owner NIN must be 11 digits').optional().or(z.literal('')),
}).refine((values) => !(values.ownerUserId && values.ownerNin), {
  message: 'Provide owner user ID or owner NIN, not both',
  path: ['ownerUserId'],
});

type OrgValues = z.infer<typeof orgSchema>;

const ownerTypeOptions = [
  'government',
  'private',
  'non_profit',
  'faith_based',
  'ngo',
  'public_private_partnership',
  'other',
] as const;

function cap(value: string) {
  if (!value) return value;
  return value
    .split(/[_\s-]+/)
    .map((entry) => (entry ? `${entry[0].toUpperCase()}${entry.slice(1)}` : ''))
    .join(' ');
}

function extractOrganizationId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const org = record.organization && typeof record.organization === 'object'
    ? (record.organization as Record<string, unknown>)
    : null;
  const direct = typeof record.organizationId === 'string' ? record.organizationId : null;
  const nested = org && typeof org.organizationId === 'string' ? org.organizationId : null;
  return nested || direct || null;
}

function OrganizationLogo({ row }: { row: OrganizationRow }) {
  if (row.logoUrl) {
    return (
      <img
        src={row.logoUrl}
        alt={`${row.name} logo`}
        className="h-12 w-12 rounded-md border border-border object-cover"
        loading="lazy"
      />
    );
  }
  const initials = row.name
    .split(' ')
    .map((entry) => entry[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-foreground">
      {initials || 'OR'}
    </div>
  );
}

export function OrganizationsPage() {
  const navigate = useNavigate();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const currentUserNin = useAuthStore((state) => state.user?.nin || '');
  const activeContext = useContextStore((state) => state.activeContext);
  const inOrganizationContext = activeContext?.type === 'organization';
  const activeOrganizationId = getOrganizationIdFromContext(activeContext);
  const canListAll = hasPermission('org.list_all');
  const [q, setQ] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'affiliated' | 'all'>('affiliated');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<OrganizationRow | null>(null);
  const [deleteRequestTarget, setDeleteRequestTarget] = useState<OrganizationRow | null>(null);
  const [deleteRequestReason, setDeleteRequestReason] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [cacFile, setCacFile] = useState<File | null>(null);
  const effectiveScopeFilter: 'affiliated' | 'all' =
    canListAll && !inOrganizationContext ? scopeFilter : 'affiliated';

  const query = useOrganizations({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: q || undefined,
    scope: effectiveScopeFilter,
  });
  const activeOrgDetailsQuery = useOrgDetails(inOrganizationContext ? activeOrganizationId : undefined);
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();
  const requestDeletion = useRequestOrganizationDeletion();
  const uploadOrgFile = useUploadOrganizationFile();

  const form = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
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
      ownerUserId: '',
      ownerNin: currentUserNin || '',
    },
  });
  const selectedStateName = form.watch('state');
  const selectedLgaName = form.watch('lga');

  const geoStatesQuery = useGeoStates();
  const geoStates = geoStatesQuery.data ?? [];
  const selectedState = useMemo(
    () => geoStates.find((entry) => entry.name.toLowerCase() === selectedStateName.toLowerCase()) ?? null,
    [geoStates, selectedStateName],
  );
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
    if (editing) return;
    const ownerNin = form.getValues('ownerNin')?.trim() || '';
    const ownerUserId = form.getValues('ownerUserId')?.trim() || '';
    if (!ownerNin && !ownerUserId && currentUserNin) {
      form.setValue('ownerNin', currentUserNin, { shouldDirty: false, shouldValidate: false });
    }
  }, [currentUserNin, editing, form]);

  const rows = useMemo(() => {
    if (inOrganizationContext) {
      return activeOrgDetailsQuery.data?.organization ? [activeOrgDetailsQuery.data.organization] : [];
    }
    return query.data?.rows ?? [];
  }, [activeOrgDetailsQuery.data?.organization, inOrganizationContext, query.data?.rows]);
  const totalRows = rows.length;

  const openCreateModal = useCallback(() => {
    setEditing(null);
    setLogoFile(null);
    setCacFile(null);
    form.reset({
      name: '',
      description: '',
      registrationNumber: '',
      ownerType: '',
      foundedAt: '',
      openedAt: '',
      website: '',
      state: '',
      lga: '',
      ownerUserId: '',
      ownerNin: currentUserNin || '',
    });
    setShowModal(true);
  }, [currentUserNin, form]);

  const openEditModal = useCallback((row: OrganizationRow) => {
    setEditing(row);
    setLogoFile(null);
    setCacFile(null);
    form.reset({
      name: row.name,
      description: row.description || '',
      registrationNumber: row.registrationNumber || '',
      ownerType: row.ownerType || '',
      foundedAt: row.foundedAt ? String(row.foundedAt).slice(0, 10) : '',
      openedAt: row.openedAt ? String(row.openedAt).slice(0, 10) : '',
      website: row.website || '',
      state: row.state === 'N/A' ? '' : row.state,
      lga: row.lga === 'N/A' ? '' : row.lga,
      ownerUserId: '',
      ownerNin: '',
    });
    setShowModal(true);
  }, [form]);

  const columns = useMemo<ColumnDef<OrganizationRow>[]>(() => [
    { accessorKey: 'name', header: 'Organization' },
    { accessorKey: 'ownerType', header: 'Owner', cell: ({ row }) => cap(row.original.ownerType || 'N/A') },
    { accessorKey: 'state', header: 'State' },
    { accessorKey: 'lga', header: 'LGA' },
    {
      accessorKey: 'approvalStatus',
      header: 'Approval',
      cell: ({ row }) => <StatusBadge status={row.original.approvalStatus || 'pending'} />,
    },
    {
      accessorKey: 'lifecycleStatus',
      header: 'Lifecycle',
      cell: ({ row }) => <StatusBadge status={row.original.lifecycleStatus || row.original.status || 'active'} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/app/organizations/${row.original.organizationId}`)}>
            Open
          </Button>
          {inOrganizationContext ? (
            <PermissionGate permission="org.member.read">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/app/organizations/${row.original.organizationId}/staff`)}
              >
                Staff
              </Button>
            </PermissionGate>
          ) : null}
          <PermissionGate permission="org.update">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openEditModal(row.original)}>
                Edit
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  setDeleteRequestTarget(row.original);
                  setDeleteRequestReason('');
                }}
                title="Request deletion"
                disabled={row.original.lifecycleStatus === 'delete_pending'}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </PermissionGate>
        </div>
      ),
    },
  ], [inOrganizationContext, navigate, openEditModal]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const ownerNin = values.ownerNin?.trim() || '';
      const ownerUserId = values.ownerUserId?.trim() || '';
      if (!editing && ownerNin) {
        try {
          await apiClient.get<Record<string, unknown>>(endpoints.auth.ninLookup(ownerNin), {
            suppressGlobalErrors: true,
          });
          form.clearErrors('ownerNin');
        } catch {
          form.setError('ownerNin', {
            type: 'validate',
            message: 'Owner NIN could not be found in the system',
          });
          toast.error('Owner NIN could not be found in the system');
          return;
        }
      }

      const payload = {
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
      };

      let orgId = editing?.organizationId || null;
      if (editing) {
        const updated = await updateOrg.mutateAsync({ orgId: editing.organizationId, ...payload });
        orgId = extractOrganizationId(updated);
      } else {
        const created = await createOrg.mutateAsync({
          ...payload,
          ownerUserId: ownerUserId || undefined,
          ownerNin: ownerNin || undefined,
        });
        orgId = extractOrganizationId(created);
      }

      if (orgId && logoFile) {
        await uploadOrgFile.mutateAsync({ orgId, kind: 'logo', file: logoFile });
      }
      if (orgId && cacFile) {
        await uploadOrgFile.mutateAsync({ orgId, kind: 'cac', file: cacFile });
      }

      toast.success(editing ? 'Organization updated' : 'Organization created');
      setShowModal(false);
      setEditing(null);
      setLogoFile(null);
      setCacFile(null);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save organization');
    }
  });

  const savingForm = createOrg.isPending || updateOrg.isPending || uploadOrgFile.isPending;
  const ownerUserIdValue = form.watch('ownerUserId');
  const ownerNinValue = form.watch('ownerNin');
  const ownerOverrideSelected = !editing && (
    Boolean(ownerUserIdValue?.trim().length)
    || (ownerNinValue?.trim().length ? ownerNinValue.trim() !== currentUserNin : false)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description={
          inOrganizationContext
            ? 'Organization workspace view for your active context.'
            : 'Manage organization records, ownership, and deletion lifecycle.'
        }
        breadcrumbs={[{ label: 'Organization' }, { label: 'Organizations' }]}
        actions={(
          <div className="flex flex-wrap gap-2">
            {inOrganizationContext ? (
              <PermissionGate permission="org.member.read">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (activeOrganizationId) {
                      navigate(`/app/organizations/${activeOrganizationId}/staff`);
                    }
                  }}
                  disabled={!activeOrganizationId}
                >
                  <UserCog className="h-4 w-4" />
                  Manage Staff
                </Button>
              </PermissionGate>
            ) : (
              <>
                <PermissionGate permission="org.update">
                  <Button variant="outline" onClick={() => navigate('/app/organizations/approvals')}>
                    Approvals
                  </Button>
                </PermissionGate>
                <Button variant="outline" onClick={() => navigate('/app/organizations/deleted')}>
                  <History className="h-4 w-4" />
                  Deleted
                </Button>
                <PermissionGate permission="org.create">
                  <Button onClick={openCreateModal}>
                    <Plus className="h-4 w-4" />
                    Create Organization
                  </Button>
                </PermissionGate>
              </>
            )}
          </div>
        )}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search organizations" />
        </div>
        {!inOrganizationContext ? (
          <div className="inline-flex rounded-md border border-border p-1">
            <Button
              variant={effectiveScopeFilter === 'affiliated' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setScopeFilter('affiliated')}
            >
              My Organizations
            </Button>
            {canListAll ? (
              <Button
                variant={effectiveScopeFilter === 'all' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setScopeFilter('all')}
              >
                All Organizations
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="inline-flex rounded-md border border-border p-1">
          <Button variant={viewMode === 'table' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('table')}>
            <List className="h-4 w-4" />
            Table
          </Button>
          <Button variant={viewMode === 'card' ? 'default' : 'ghost'} size="sm" onClick={() => setViewMode('card')}>
            <LayoutGrid className="h-4 w-4" />
            Cards
          </Button>
        </div>
      </FilterBar>

      {(inOrganizationContext ? activeOrgDetailsQuery.isError : query.isError) ? (
        <ErrorState
          title="Unable to load organizations"
          description="Retry loading organization records."
          onRetry={() => {
            if (inOrganizationContext) {
              void activeOrgDetailsQuery.refetch();
            } else {
              void query.refetch();
            }
          }}
        />
      ) : viewMode === 'table' ? (
        <DataTable
          columns={columns}
          data={rows}
          total={totalRows}
          loading={inOrganizationContext ? activeOrgDetailsQuery.isLoading : query.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(totalRows / pagination.pageSize))}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.organizationId} className="border border-border/60">
              <CardHeader className="space-y-3">
                <div className="flex items-center gap-3">
                  <OrganizationLogo row={row} />
                  <div className="min-w-0">
                    <CardTitle className="truncate">{row.name}</CardTitle>
                    <CardDescription>{row.state}, {row.lga}</CardDescription>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/app/organizations/${row.organizationId}`)}>
                    Open
                  </Button>
                  {inOrganizationContext ? (
                    <PermissionGate permission="org.member.read">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/app/organizations/${row.organizationId}/staff`)}
                      >
                        Staff
                      </Button>
                    </PermissionGate>
                  ) : null}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onOpenChange={setShowModal} title={editing ? 'Edit Organization' : 'Create Organization'}>
        <form className="space-y-3" onSubmit={onSubmit}>
          <FormField label="Organization Name">
            <Input {...form.register('name')} />
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Owner Type">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...form.register('ownerType')}>
                <option value="">Select owner type</option>
                {ownerTypeOptions.map((option) => (
                  <option key={option} value={option}>{cap(option)}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Registration Number">
              <Input {...form.register('registrationNumber')} />
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Founded Date">
              <Input type="date" {...form.register('foundedAt')} />
            </FormField>
            <FormField label="Opened Date">
              <Input type="date" {...form.register('openedAt')} />
            </FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Website">
              <Input {...form.register('website')} />
            </FormField>
            <FormField label="Description">
              <Input {...form.register('description')} />
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
          {!editing ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Owner User ID (optional)">
                  <Input
                    {...form.register('ownerUserId')}
                    onChange={(event) => {
                      form.setValue('ownerUserId', event.target.value, { shouldDirty: true, shouldValidate: true });
                      if (event.target.value.trim().length > 0) {
                        form.setValue('ownerNin', '', { shouldDirty: true, shouldValidate: true });
                      }
                    }}
                  />
                </FormField>
                <FormField label="Owner NIN (optional)">
                  <Input
                    {...form.register('ownerNin')}
                    placeholder={currentUserNin || 'Enter 11-digit owner NIN'}
                    onChange={(event) => {
                      form.setValue('ownerNin', event.target.value, { shouldDirty: true, shouldValidate: true });
                      if (event.target.value.trim().length > 0) {
                        form.setValue('ownerUserId', '', { shouldDirty: true, shouldValidate: true });
                      }
                    }}
                  />
                </FormField>
              </div>
              <p className="text-xs text-muted">
                Owner NIN defaults to the current logged-in user and can be changed before submission.
              </p>
              {ownerOverrideSelected ? (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  You are assigning another owner. Add yourself as organization staff if you still need access to this organization.
                </div>
              ) : null}
            </>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Logo Upload (optional)">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
              />
            </FormField>
            <FormField label="CAC Document Upload (optional)">
              <Input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => setCacFile(event.target.files?.[0] || null)}
              />
            </FormField>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" loading={savingForm}>
              Save
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={Boolean(deleteRequestTarget)} onOpenChange={(open) => { if (!open) setDeleteRequestTarget(null); }} title="Request Organization Deletion">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!deleteRequestTarget) return;
            await requestDeletion.mutateAsync({
              orgId: deleteRequestTarget.organizationId,
              reason: deleteRequestReason || undefined,
            });
            setDeleteRequestTarget(null);
            setDeleteRequestReason('');
          }}
        >
          <FormField label="Reason (optional)">
            <Input value={deleteRequestReason} onChange={(event) => setDeleteRequestReason(event.target.value)} />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteRequestTarget(null)}>Cancel</Button>
            <Button type="submit" loading={requestDeletion.isPending}>
              Request Deletion
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
