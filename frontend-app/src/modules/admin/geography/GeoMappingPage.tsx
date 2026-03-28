import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { SmartSelect } from '@/components/data/SmartSelect';
import { DataTable } from '@/components/data/DataTable';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import {
  type GeoLgaRow,
  type GeoRegionRow,
  type GeoStateRow,
  useCreateGeoLga,
  useCreateGeoRegion,
  useCreateGeoState,
  useGeoLgas,
  useGeoRegions,
  useGeoStates,
  useUpdateGeoLga,
  useUpdateGeoRegion,
  useUpdateGeoState,
} from '@/api/hooks/useGeography';

const regionSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  code: z.string().optional(),
  status: z.enum(['active', 'inactive']),
});

const stateSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  code: z.string().optional(),
  regionId: z.string().min(1, 'Region is required'),
  status: z.enum(['active', 'inactive']),
});

const lgaSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  code: z.string().optional(),
  stateId: z.string().min(1, 'State is required'),
  status: z.enum(['active', 'inactive']),
});

type RegionFormValues = z.infer<typeof regionSchema>;
type StateFormValues = z.infer<typeof stateSchema>;
type LgaFormValues = z.infer<typeof lgaSchema>;

export function GeoMappingPage() {
  const [regionQ, setRegionQ] = useState('');
  const [stateQ, setStateQ] = useState('');
  const [lgaQ, setLgaQ] = useState('');
  const [stateRegionFilter, setStateRegionFilter] = useState<string | null>(null);
  const [lgaStateFilter, setLgaStateFilter] = useState<string | null>(null);
  const [regionPagination, setRegionPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [statePagination, setStatePagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [lgaPagination, setLgaPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });

  const [editingRegion, setEditingRegion] = useState<GeoRegionRow | null>(null);
  const [editingState, setEditingState] = useState<GeoStateRow | null>(null);
  const [editingLga, setEditingLga] = useState<GeoLgaRow | null>(null);

  const regionsQuery = useGeoRegions({ q: regionQ || undefined, includeInactive: true });
  const statesQuery = useGeoStates({
    q: stateQ || undefined,
    regionId: stateRegionFilter || undefined,
    includeInactive: true,
  });
  const lgasQuery = useGeoLgas({
    q: lgaQ || undefined,
    stateId: lgaStateFilter || undefined,
    includeInactive: true,
  });

  const createRegion = useCreateGeoRegion();
  const updateRegion = useUpdateGeoRegion();
  const createState = useCreateGeoState();
  const updateState = useUpdateGeoState();
  const createLga = useCreateGeoLga();
  const updateLga = useUpdateGeoLga();

  const regionForm = useForm<RegionFormValues>({
    resolver: zodResolver(regionSchema),
    defaultValues: { name: '', code: '', status: 'active' },
  });
  const stateForm = useForm<StateFormValues>({
    resolver: zodResolver(stateSchema),
    defaultValues: { name: '', code: '', regionId: '', status: 'active' },
  });
  const lgaForm = useForm<LgaFormValues>({
    resolver: zodResolver(lgaSchema),
    defaultValues: { name: '', code: '', stateId: '', status: 'active' },
  });

  const regions = regionsQuery.data ?? [];
  const states = statesQuery.data ?? [];
  const lgas = lgasQuery.data ?? [];

  const regionOptions = useMemo(
    () => regions.map((entry) => ({ value: entry.regionId, label: `${entry.name} (${entry.code})` })),
    [regions],
  );
  const stateOptions = useMemo(
    () => states.map((entry) => ({ value: entry.stateId, label: `${entry.name} (${entry.code})` })),
    [states],
  );

  const regionColumns = useMemo<ColumnDef<GeoRegionRow>[]>(() => [
    { accessorKey: 'name', header: 'Region' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingRegion(row.original);
            regionForm.reset({
              name: row.original.name,
              code: row.original.code,
              status: row.original.status === 'inactive' ? 'inactive' : 'active',
            });
          }}
        >
          Edit
        </Button>
      ),
    },
  ], [regionForm]);

  const stateColumns = useMemo<ColumnDef<GeoStateRow>[]>(() => [
    { accessorKey: 'name', header: 'State' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'regionName', header: 'Region' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingState(row.original);
            stateForm.reset({
              name: row.original.name,
              code: row.original.code,
              regionId: row.original.regionId,
              status: row.original.status === 'inactive' ? 'inactive' : 'active',
            });
          }}
        >
          Edit
        </Button>
      ),
    },
  ], [stateForm]);

  const lgaColumns = useMemo<ColumnDef<GeoLgaRow>[]>(() => [
    { accessorKey: 'name', header: 'LGA' },
    { accessorKey: 'code', header: 'Code' },
    { accessorKey: 'stateName', header: 'State' },
    { accessorKey: 'regionName', header: 'Region' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingLga(row.original);
            lgaForm.reset({
              name: row.original.name,
              code: row.original.code,
              stateId: row.original.stateId,
              status: row.original.status === 'inactive' ? 'inactive' : 'active',
            });
          }}
        >
          Edit
        </Button>
      ),
    },
  ], [lgaForm]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Geography Mapping"
        description="One source of truth for regions, states, and local governments."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Geography Mapping' }]}
      />

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Regions</CardTitle>
              <CardDescription>Maintain geopolitical regions.</CardDescription>
            </div>
            <Button
              onClick={() => {
                setEditingRegion({ regionId: '', name: '', code: '', status: 'active' });
                regionForm.reset({ name: '', code: '', status: 'active' });
              }}
            >
              <Plus className="h-4 w-4" />
              Add Region
            </Button>
          </div>
        </CardHeader>
        <div className="space-y-4 p-6 pt-0">
          <FilterBar>
            <div className="w-full md:max-w-sm">
              <SearchInput value={regionQ} onChange={setRegionQ} placeholder="Search regions" />
            </div>
          </FilterBar>
          <DataTable
            columns={regionColumns}
            data={regions}
            total={regions.length}
            loading={regionsQuery.isLoading}
            pagination={regionPagination}
            onPaginationChange={setRegionPagination}
            pageCount={Math.max(1, Math.ceil(regions.length / regionPagination.pageSize))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>States</CardTitle>
              <CardDescription>Assign states to regions.</CardDescription>
            </div>
            <Button
              onClick={() => {
                setEditingState({ stateId: '', name: '', code: '', regionId: '', status: 'active' });
                stateForm.reset({ name: '', code: '', regionId: '', status: 'active' });
              }}
            >
              <Plus className="h-4 w-4" />
              Add State
            </Button>
          </div>
        </CardHeader>
        <div className="space-y-4 p-6 pt-0">
          <FilterBar>
            <div className="w-full md:max-w-sm">
              <SearchInput value={stateQ} onChange={setStateQ} placeholder="Search states" />
            </div>
            <div className="w-full md:max-w-sm">
              <SmartSelect
                value={stateRegionFilter}
                onChange={setStateRegionFilter}
                placeholder="Filter by region"
                loadOptions={async (input) =>
                  regionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </div>
          </FilterBar>
          <DataTable
            columns={stateColumns}
            data={states}
            total={states.length}
            loading={statesQuery.isLoading}
            pagination={statePagination}
            onPaginationChange={setStatePagination}
            pageCount={Math.max(1, Math.ceil(states.length / statePagination.pageSize))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Local Governments</CardTitle>
              <CardDescription>Assign LGAs to states and regions.</CardDescription>
            </div>
            <Button
              onClick={() => {
                setEditingLga({ lgaId: '', name: '', code: '', stateId: '', status: 'active' });
                lgaForm.reset({ name: '', code: '', stateId: '', status: 'active' });
              }}
            >
              <Plus className="h-4 w-4" />
              Add LGA
            </Button>
          </div>
        </CardHeader>
        <div className="space-y-4 p-6 pt-0">
          <FilterBar>
            <div className="w-full md:max-w-sm">
              <SearchInput value={lgaQ} onChange={setLgaQ} placeholder="Search LGAs" />
            </div>
            <div className="w-full md:max-w-sm">
              <SmartSelect
                value={lgaStateFilter}
                onChange={setLgaStateFilter}
                placeholder="Filter by state"
                loadOptions={async (input) =>
                  stateOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            </div>
          </FilterBar>
          <DataTable
            columns={lgaColumns}
            data={lgas}
            total={lgas.length}
            loading={lgasQuery.isLoading}
            pagination={lgaPagination}
            onPaginationChange={setLgaPagination}
            pageCount={Math.max(1, Math.ceil(lgas.length / lgaPagination.pageSize))}
          />
        </div>
      </Card>

      <Modal
        open={Boolean(editingRegion)}
        onOpenChange={(open) => {
          if (!open) setEditingRegion(null);
        }}
        title={editingRegion?.regionId ? 'Edit Region' : 'Create Region'}
      >
        <form
          className="space-y-3"
          onSubmit={regionForm.handleSubmit(async (values) => {
            if (editingRegion?.regionId) {
              await updateRegion.mutateAsync({ regionId: editingRegion.regionId, ...values });
            } else {
              await createRegion.mutateAsync(values);
            }
            setEditingRegion(null);
          })}
        >
          <FormField label="Region Name">
            <Input {...regionForm.register('name')} />
          </FormField>
          <FormField label="Region Code">
            <Input {...regionForm.register('code')} />
          </FormField>
          <FormField label="Status">
            <select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" {...regionForm.register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditingRegion(null)}>Cancel</Button>
            <Button type="submit" loading={createRegion.isPending || updateRegion.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        open={Boolean(editingState)}
        onOpenChange={(open) => {
          if (!open) setEditingState(null);
        }}
        title={editingState?.stateId ? 'Edit State' : 'Create State'}
      >
        <form
          className="space-y-3"
          onSubmit={stateForm.handleSubmit(async (values) => {
            if (editingState?.stateId) {
              await updateState.mutateAsync({ stateId: editingState.stateId, ...values });
            } else {
              await createState.mutateAsync(values);
            }
            setEditingState(null);
          })}
        >
          <FormField label="State Name">
            <Input {...stateForm.register('name')} />
          </FormField>
          <FormField label="State Code">
            <Input {...stateForm.register('code')} />
          </FormField>
          <FormField label="Region">
            <SmartSelect
              value={stateForm.watch('regionId') || null}
              onChange={(value) => stateForm.setValue('regionId', value || '', { shouldDirty: true, shouldValidate: true })}
              placeholder="Select region"
              loadOptions={async (input) =>
                regionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
          </FormField>
          <FormField label="Status">
            <select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" {...stateForm.register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditingState(null)}>Cancel</Button>
            <Button type="submit" loading={createState.isPending || updateState.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        open={Boolean(editingLga)}
        onOpenChange={(open) => {
          if (!open) setEditingLga(null);
        }}
        title={editingLga?.lgaId ? 'Edit LGA' : 'Create LGA'}
      >
        <form
          className="space-y-3"
          onSubmit={lgaForm.handleSubmit(async (values) => {
            if (editingLga?.lgaId) {
              await updateLga.mutateAsync({ lgaId: editingLga.lgaId, ...values });
            } else {
              await createLga.mutateAsync(values);
            }
            setEditingLga(null);
          })}
        >
          <FormField label="LGA Name">
            <Input {...lgaForm.register('name')} />
          </FormField>
          <FormField label="LGA Code">
            <Input {...lgaForm.register('code')} />
          </FormField>
          <FormField label="State">
            <SmartSelect
              value={lgaForm.watch('stateId') || null}
              onChange={(value) => lgaForm.setValue('stateId', value || '', { shouldDirty: true, shouldValidate: true })}
              placeholder="Select state"
              loadOptions={async (input) =>
                stateOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
          </FormField>
          <FormField label="Status">
            <select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" {...lgaForm.register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditingLga(null)}>Cancel</Button>
            <Button type="submit" loading={createLga.isPending || updateLga.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
