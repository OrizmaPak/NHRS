import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { ApiClientError } from '@/api/apiClient';
import { useCreateGlobalService, useDeleteGlobalService, useGlobalServices, type GlobalServiceRow } from '@/api/hooks/useGlobalServices';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/feedback/ErrorState';

const schema = z.object({
  name: z.string().min(2, 'Service name is required'),
  description: z.string().min(8, 'Service description is required'),
});

type Values = z.infer<typeof schema>;

export function GlobalServicesPage() {
  const [q, setQ] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);

  const globalServicesQuery = useGlobalServices({ q, limit: 500 });
  const createGlobalService = useCreateGlobalService();
  const deleteGlobalService = useDeleteGlobalService();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const rows = globalServicesQuery.data?.rows ?? [];

  const columns = useMemo<ColumnDef<GlobalServiceRow>[]>(() => [
    { accessorKey: 'name', header: 'Service' },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <p className="max-w-2xl text-sm text-foreground">{row.original.description || 'No description'}</p>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          loading={deleteGlobalService.isPending && deletingServiceId === row.original.serviceId}
          onClick={async () => {
            const confirmed = window.confirm(
              `Delete "${row.original.name}" from the global services catalog? This only removes it from future selection.`,
            );
            if (!confirmed) return;
            setDeletingServiceId(row.original.serviceId);
            try {
              await deleteGlobalService.mutateAsync(row.original.serviceId);
            } finally {
              setDeletingServiceId(null);
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      ),
    },
  ], [deleteGlobalService, deletingServiceId]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createGlobalService.mutateAsync({
        name: values.name,
        description: values.description,
      });
      form.reset({ name: '', description: '' });
      setModalOpen(false);
    } catch (error) {
      if (
        error instanceof ApiClientError
        && (error.status === 409 || /already exists/i.test(error.message))
      ) {
        form.setError('name', {
          type: 'manual',
          message: 'A service with this exact name already exists. Please use the existing one instead.',
        });
        return;
      }
      throw error;
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global Services"
        description="Manage the shared service catalog used by institution and branch additional-service fields across the platform."
        breadcrumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Global Services' }]}
        actions={(
          <Button
            onClick={() => {
              form.reset({ name: '', description: '' });
              setModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Create Service
          </Button>
        )}
      />

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Catalog Guidance</CardTitle>
          <CardDescription>
            Please ensure you are not creating a duplicate service that already exists. It will reduce visibility.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Available Services</CardTitle>
          <CardDescription>These services appear automatically anywhere institutions and branches choose additional services.</CardDescription>
        </CardHeader>
        <div className="space-y-4 p-6 pt-0">
          <FilterBar>
            <div className="w-full md:max-w-sm">
              <SearchInput value={q} onChange={setQ} placeholder="Search global services" />
            </div>
          </FilterBar>

          {globalServicesQuery.isError ? (
            <ErrorState
              title="Unable to load global services"
              description="Retry loading the shared service catalog."
              onRetry={() => globalServicesQuery.refetch()}
            />
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              total={globalServicesQuery.data?.total ?? rows.length}
              loading={globalServicesQuery.isLoading}
              pagination={pagination}
              onPaginationChange={setPagination}
              pageCount={Math.max(1, Math.ceil((globalServicesQuery.data?.total ?? rows.length) / pagination.pageSize))}
            />
          )}
        </div>
      </Card>

      <Modal open={modalOpen} onOpenChange={setModalOpen} title="Create Global Service">
        <form className="space-y-3" onSubmit={onSubmit}>
          <FormField
            label="Service Name"
            error={form.formState.errors.name?.message}
            hint="Use a clear service name that people across the platform will recognize."
          >
            <Input {...form.register('name')} />
          </FormField>
          <FormField
            label="Service Description"
            error={form.formState.errors.description?.message}
            hint="Explain what the service covers so institutions and branches can choose it correctly."
          >
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="Example: Diagnostic imaging, scan interpretation support, and imaging-related patient services."
              {...form.register('description')}
            />
          </FormField>
          <p className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Please ensure you are not creating a duplicate service that already exists. It will reduce visibility.
          </p>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={createGlobalService.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
