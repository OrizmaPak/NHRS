import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { z } from 'zod';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Plus, Save } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import {
  useCreateBranch,
  useCreateInstitution,
  useInstitutionBranches,
  useInstitutions,
  useUpdateBranch,
  useUpdateInstitution,
  type BranchCapability,
  type BranchRow,
  type InstitutionRow,
  type OrganizationType,
} from '@/api/hooks/useInstitutions';

const orgTypes: OrganizationType[] = ['hospital', 'laboratory', 'pharmacy', 'government', 'emergency', 'catalog'];
const branchCapabilities: BranchCapability[] = ['hospital', 'clinic', 'laboratory', 'pharmacy'];

const createOrgSchema = z.object({
  name: z.string().min(2, 'Organization name is required'),
  type: z.enum(['hospital', 'laboratory', 'pharmacy', 'government', 'emergency', 'catalog']),
  description: z.string().optional(),
  registrationNumber: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
  ownerNin: z.string().regex(/^\d{11}$/, 'Owner NIN must be 11 digits').optional().or(z.literal('')),
});

const updateOrgSchema = z.object({
  name: z.string().min(2, 'Organization name is required'),
  description: z.string().optional(),
  registrationNumber: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
  status: z.enum(['active', 'suspended']),
});

const branchSchema = z.object({
  name: z.string().min(2, 'Branch name is required'),
  code: z.string().min(2, 'Branch code is required'),
  capabilities: z.array(z.enum(['hospital', 'clinic', 'laboratory', 'pharmacy'])).min(1, 'Select at least one capability'),
  state: z.string().optional(),
  lga: z.string().optional(),
  status: z.enum(['active', 'closed']).default('active'),
});

type CreateOrgValues = z.infer<typeof createOrgSchema>;
type UpdateOrgValues = z.infer<typeof updateOrgSchema>;
type BranchValues = z.infer<typeof branchSchema>;

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function AdminInstitutionsPage() {
  const [query, setQuery] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [branchPagination, setBranchPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [selectedOrg, setSelectedOrg] = useState<InstitutionRow | null>(null);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showEditOrg, setShowEditOrg] = useState(false);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const institutionsQuery = useInstitutions({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: query || undefined,
  });

  const branchesQuery = useInstitutionBranches(selectedOrg?.organizationId);
  const createInstitution = useCreateInstitution();
  const updateInstitution = useUpdateInstitution();
  const createBranch = useCreateBranch();
  const updateBranch = useUpdateBranch();

  const createOrgForm = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: {
      name: '',
      type: 'hospital',
      description: '',
      registrationNumber: '',
      state: '',
      lga: '',
      ownerNin: '',
    },
  });

  const editOrgForm = useForm<UpdateOrgValues>({
    resolver: zodResolver(updateOrgSchema),
    defaultValues: {
      name: '',
      description: '',
      registrationNumber: '',
      state: '',
      lga: '',
      status: 'active',
    },
  });

  const branchForm = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: {
      name: '',
      code: '',
      capabilities: [],
      state: '',
      lga: '',
      status: 'active',
    },
  });
  const selectedCapabilities = useWatch({ control: branchForm.control, name: 'capabilities', defaultValue: [] });

  const orgColumns = useMemo<ColumnDef<InstitutionRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Organization' },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => capitalize(row.original.type),
      },
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'lga', header: 'LGA' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={selectedOrg?.organizationId === row.original.organizationId ? 'default' : 'outline'}
              onClick={() => setSelectedOrg(row.original)}
            >
              Branches
            </Button>
            <PermissionGate permission="org.update">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedOrg(row.original);
                  editOrgForm.reset({
                    name: row.original.name,
                    description: row.original.description ?? '',
                    registrationNumber: row.original.registrationNumber ?? '',
                    state: row.original.state === 'N/A' ? '' : row.original.state,
                    lga: row.original.lga === 'N/A' ? '' : row.original.lga,
                    status: row.original.status === 'suspended' ? 'suspended' : 'active',
                  });
                  setFormError(null);
                  setShowEditOrg(true);
                }}
              >
                Edit
              </Button>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [selectedOrg?.organizationId, editOrgForm],
  );

  const branchColumns = useMemo<ColumnDef<BranchRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Branch' },
      { accessorKey: 'code', header: 'Code' },
      {
        accessorKey: 'capabilities',
        header: 'Capabilities',
        cell: ({ row }) => row.original.capabilities.map((cap) => capitalize(cap)).join(', ') || 'N/A',
      },
      { accessorKey: 'state', header: 'State' },
      { accessorKey: 'lga', header: 'LGA' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'branch-actions',
        header: 'Actions',
        cell: ({ row }) => (
          <PermissionGate permission="org.branch.update">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const current = row.original;
                setEditingBranch(current);
                branchForm.reset({
                  name: current.name,
                  code: current.code,
                  capabilities: current.capabilities,
                  state: current.state === 'N/A' ? '' : current.state,
                  lga: current.lga === 'N/A' ? '' : current.lga,
                  status: current.status === 'closed' ? 'closed' : 'active',
                });
                setFormError(null);
              }}
            >
              Edit
            </Button>
          </PermissionGate>
        ),
      },
    ],
    [branchForm],
  );

  const submitCreateOrg = createOrgForm.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const payload = {
        name: values.name,
        type: values.type,
        description: values.description || undefined,
        registrationNumber: values.registrationNumber || undefined,
        ownerNin: values.ownerNin || undefined,
        location: {
          state: values.state || undefined,
          lga: values.lga || undefined,
        },
      };
      const response = await createInstitution.mutateAsync(payload);
      const organization = (response as { organization?: unknown })?.organization as Record<string, unknown> | undefined;
      const createdId = typeof organization?.organizationId === 'string' ? organization.organizationId : null;
      createOrgForm.reset();
      setShowCreateOrg(false);
      if (createdId) {
        const matched = institutionsQuery.data?.rows.find((item) => item.organizationId === createdId) ?? null;
        if (matched) setSelectedOrg(matched);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create organization');
    }
  });

  const submitEditOrg = editOrgForm.handleSubmit(async (values) => {
    if (!selectedOrg) return;
    setFormError(null);
    try {
      await updateInstitution.mutateAsync({
        orgId: selectedOrg.organizationId,
        name: values.name,
        description: values.description || undefined,
        registrationNumber: values.registrationNumber || undefined,
        location: {
          state: values.state || undefined,
          lga: values.lga || undefined,
        },
        status: values.status,
      });
      setShowEditOrg(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to update organization');
    }
  });

  const submitBranch = branchForm.handleSubmit(async (values) => {
    if (!selectedOrg) return;
    setFormError(null);
    try {
      if (editingBranch) {
        await updateBranch.mutateAsync({
          orgId: selectedOrg.organizationId,
          branchId: editingBranch.id,
          name: values.name,
          code: values.code,
          capabilities: values.capabilities,
          status: values.status,
          location: {
            state: values.state || undefined,
            lga: values.lga || undefined,
          },
        });
        setEditingBranch(null);
      } else {
        await createBranch.mutateAsync({
          orgId: selectedOrg.organizationId,
          name: values.name,
          code: values.code,
          capabilities: values.capabilities,
          location: {
            state: values.state || undefined,
            lga: values.lga || undefined,
          },
        });
        setShowCreateBranch(false);
      }
      branchForm.reset({
        name: '',
        code: '',
        capabilities: [],
        state: '',
        lga: '',
        status: 'active',
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save branch');
    }
  });

  const branchRows = branchesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin - Organizations"
        description="Create organizations and manage branches with multi-capability setup for hospitals, clinics, labs, and pharmacies."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Institutions' }]}
        actions={(
          <PermissionGate permission="org.create">
            <Button
              onClick={() => {
                setFormError(null);
                setShowCreateOrg(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New Organization
            </Button>
          </PermissionGate>
        )}
      />

      <FilterBar>
        <div className="w-full md:max-w-md">
          <SearchInput value={query} onChange={setQuery} placeholder="Search organizations by name or registration number" />
        </div>
      </FilterBar>

      {institutionsQuery.isError ? (
        <ErrorState title="Unable to load organizations" description="Please retry." onRetry={() => institutionsQuery.refetch()} />
      ) : (
        <DataTable
          columns={orgColumns}
          data={institutionsQuery.data?.rows ?? []}
          total={institutionsQuery.data?.total ?? 0}
          loading={institutionsQuery.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((institutionsQuery.data?.total ?? 0) / pagination.pageSize))}
        />
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {selectedOrg ? `Branches: ${selectedOrg.name}` : 'Branch Management'}
            </CardTitle>
            <CardDescription>
              {selectedOrg
                ? 'Manage branch capabilities and operational coverage for the selected organization.'
                : 'Select an organization above to view and manage branches.'}
            </CardDescription>
          </div>
          <PermissionGate permission="org.branch.create">
            <Button
              variant="outline"
              disabled={!selectedOrg}
              onClick={() => {
                if (!selectedOrg) return;
                setFormError(null);
                setEditingBranch(null);
                branchForm.reset({
                  name: '',
                  code: '',
                  capabilities: [],
                  state: selectedOrg.state !== 'N/A' ? selectedOrg.state : '',
                  lga: selectedOrg.lga !== 'N/A' ? selectedOrg.lga : '',
                  status: 'active',
                });
                setShowCreateBranch(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add Branch
            </Button>
          </PermissionGate>
        </CardHeader>
        <div className="px-6 pb-6">
          {!selectedOrg ? (
            <EmptyState
              title="No organization selected"
              description="Pick an organization from the table to configure branch-level capabilities."
            />
          ) : branchesQuery.isError ? (
            <ErrorState title="Unable to load branches" description="Please retry." onRetry={() => branchesQuery.refetch()} />
          ) : (
            <DataTable
              columns={branchColumns}
              data={branchRows}
              total={branchRows.length}
              loading={branchesQuery.isLoading}
              pagination={branchPagination}
              onPaginationChange={setBranchPagination}
              pageCount={Math.max(1, Math.ceil(branchRows.length / branchPagination.pageSize))}
            />
          )}
        </div>
      </Card>

      <Modal
        open={showCreateOrg}
        onOpenChange={setShowCreateOrg}
        title="Create organization"
        description="Create a parent organization and bootstrap ownership."
      >
        <form className="space-y-4" onSubmit={submitCreateOrg}>
          <FormField label="Organization name" error={createOrgForm.formState.errors.name?.message}>
            <Input placeholder="NHRS Central Hospital" {...createOrgForm.register('name')} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Type" error={createOrgForm.formState.errors.type?.message}>
              <select className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm" {...createOrgForm.register('type')}>
                {orgTypes.map((type) => (
                  <option key={type} value={type}>
                    {capitalize(type)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Registration number">
              <Input placeholder="Optional registration number" {...createOrgForm.register('registrationNumber')} />
            </FormField>
          </div>
          <FormField label="Description">
            <textarea
              rows={3}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              placeholder="Organization profile"
              {...createOrgForm.register('description')}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField label="State">
              <Input placeholder="State" {...createOrgForm.register('state')} />
            </FormField>
            <FormField label="LGA">
              <Input placeholder="LGA" {...createOrgForm.register('lga')} />
            </FormField>
            <FormField label="Owner NIN" hint="Optional. If omitted, creator is owner." error={createOrgForm.formState.errors.ownerNin?.message}>
              <Input placeholder="11-digit NIN" {...createOrgForm.register('ownerNin')} />
            </FormField>
          </div>
          {formError ? <p className="text-sm text-danger">{formError}</p> : null}
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowCreateOrg(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createInstitution.isPending} loadingText="Creating...">
              <Save className="h-4 w-4" />
              Create Organization
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        open={showEditOrg}
        onOpenChange={setShowEditOrg}
        title="Update organization"
        description="Edit organization metadata and operational status."
      >
        <form className="space-y-4" onSubmit={submitEditOrg}>
          <FormField label="Organization name" error={editOrgForm.formState.errors.name?.message}>
            <Input placeholder="Organization name" {...editOrgForm.register('name')} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Registration number">
              <Input placeholder="Registration number" {...editOrgForm.register('registrationNumber')} />
            </FormField>
            <FormField label="Status">
              <select className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm" {...editOrgForm.register('status')}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </FormField>
          </div>
          <FormField label="Description">
            <textarea
              rows={3}
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              placeholder="Organization profile"
              {...editOrgForm.register('description')}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="State">
              <Input placeholder="State" {...editOrgForm.register('state')} />
            </FormField>
            <FormField label="LGA">
              <Input placeholder="LGA" {...editOrgForm.register('lga')} />
            </FormField>
          </div>
          {formError ? <p className="text-sm text-danger">{formError}</p> : null}
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setShowEditOrg(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={updateInstitution.isPending} loadingText="Saving...">
              Save changes
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        open={showCreateBranch || Boolean(editingBranch)}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateBranch(false);
            setEditingBranch(null);
          }
        }}
        title={editingBranch ? 'Update branch' : 'Create branch'}
        description="Configure branch capabilities. A branch can operate multiple service capabilities."
      >
        <form className="space-y-4" onSubmit={submitBranch}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Branch name" error={branchForm.formState.errors.name?.message}>
              <Input placeholder="Branch name" {...branchForm.register('name')} />
            </FormField>
            <FormField label="Branch code" error={branchForm.formState.errors.code?.message}>
              <Input placeholder="Code (e.g. LAG-MAIN)" {...branchForm.register('code')} />
            </FormField>
          </div>
          <FormField label="Capabilities" error={branchForm.formState.errors.capabilities?.message as string | undefined}>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
              {branchCapabilities.map((capability) => {
                const checked = selectedCapabilities.includes(capability);
                return (
                  <label key={capability} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const current = branchForm.getValues('capabilities');
                        if (event.target.checked) {
                          branchForm.setValue('capabilities', Array.from(new Set([...current, capability])), { shouldValidate: true });
                        } else {
                          branchForm.setValue('capabilities', current.filter((item) => item !== capability), { shouldValidate: true });
                        }
                      }}
                    />
                    {capitalize(capability)}
                  </label>
                );
              })}
            </div>
          </FormField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField label="State">
              <Input placeholder="State" {...branchForm.register('state')} />
            </FormField>
            <FormField label="LGA">
              <Input placeholder="LGA" {...branchForm.register('lga')} />
            </FormField>
            {editingBranch ? (
              <FormField label="Status">
                <select className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm" {...branchForm.register('status')}>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </FormField>
            ) : null}
          </div>
          {formError ? <p className="text-sm text-danger">{formError}</p> : null}
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowCreateBranch(false);
                setEditingBranch(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createBranch.isPending || updateBranch.isPending}
              loadingText={editingBranch ? 'Saving...' : 'Creating...'}
            >
              {editingBranch ? 'Save branch' : 'Create branch'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
