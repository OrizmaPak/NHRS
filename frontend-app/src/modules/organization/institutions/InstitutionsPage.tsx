import { useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/Input';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import {
  type InstitutionRow,
  type InstitutionType,
  useCreateOrgInstitution,
  useOrganizations,
  useScopedInstitutions,
} from '@/api/hooks/useInstitutions';

const schema = z.object({
  orgId: z.string().min(1, 'Organization is required'),
  name: z.string().min(2),
  code: z.string().optional(),
  type: z.enum(['hospital', 'laboratory', 'pharmacy', 'clinic', 'government', 'emergency', 'catalog']),
  state: z.string().optional(),
  lga: z.string().optional(),
});
type Values = z.infer<typeof schema>;

function cap(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function InstitutionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 15 });
  const [modalOpen, setModalOpen] = useState(false);

  const orgId = searchParams.get('orgId') || undefined;

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

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      orgId: orgId || '',
      name: '',
      code: '',
      type: 'hospital',
      state: '',
      lga: '',
    },
  });

  const orgOptions = (orgsQuery.data?.rows ?? []).map((entry) => ({
    value: entry.organizationId,
    label: entry.name,
  }));

  const columns = useMemo<ColumnDef<InstitutionRow>[]>(() => [
    { accessorKey: 'name', header: 'Institution' },
    { accessorKey: 'organizationId', header: 'Organization' },
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
  ], []);

  const onSubmit = form.handleSubmit(async (values) => {
    await createInstitution.mutateAsync({
      orgId: values.orgId,
      name: values.name,
      code: values.code || undefined,
      type: values.type as InstitutionType,
      location: {
        state: values.state || undefined,
        lga: values.lga || undefined,
      },
    });
    setModalOpen(false);
    form.reset({ orgId: values.orgId, name: '', code: '', type: 'hospital', state: '', lga: '' });
  });

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
                  state: '',
                  lga: '',
                });
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
          <FormField label="Organization">
            <SmartSelect
              value={form.watch('orgId') || null}
              onChange={(next) => form.setValue('orgId', next || '', { shouldDirty: true, shouldValidate: true })}
              placeholder="Select organization"
              loadOptions={async (input) =>
                orgOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Name"><Input {...form.register('name')} /></FormField>
            <FormField label="Code"><Input {...form.register('code')} /></FormField>
          </div>
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
            <FormField label="State"><Input {...form.register('state')} /></FormField>
          </div>
          <FormField label="LGA"><Input {...form.register('lga')} /></FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={createInstitution.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
