import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey, type ApiKeyRow } from '@/api/hooks/useApiKeys';

const formSchema = z.object({
  name: z.string().min(3, 'Key name is required'),
  permissions: z.string().min(3, 'At least one permission is required'),
});

type FormValues = z.infer<typeof formSchema>;

export function ApiKeysPage() {
  const keysQuery = useApiKeys();
  const createKey = useCreateApiKey();
  const rotateKey = useRotateApiKey();
  const revokeKey = useRevokeApiKey();

  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', permissions: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = {
      name: values.name,
      permissions: values.permissions.split(',').map((entry) => entry.trim()).filter(Boolean),
    };
    const response = await createKey.mutateAsync(payload);
    setIssuedKey(response.key ?? 'nhrs_live_generated_once');
    toast.success('API key created');
    form.reset();
  });

  const rows = keysQuery.data ?? [];
  const start = pagination.pageIndex * pagination.pageSize;
  const pagedRows = rows.slice(start, start + pagination.pageSize);

  const columns = useMemo<ColumnDef<ApiKeyRow>[]>(
    () => [
      { accessorKey: 'name', header: 'Key Name' },
      { accessorKey: 'keyPreview', header: 'Key Preview' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      { accessorKey: 'createdAt', header: 'Created' },
      { accessorKey: 'lastUsedAt', header: 'Last Used', cell: ({ row }) => row.original.lastUsedAt ?? 'Never' },
      { accessorKey: 'permissions', header: 'Permissions', cell: ({ row }) => row.original.permissions.join(', ') },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const response = await rotateKey.mutateAsync(row.original.id);
                if (response.key) setIssuedKey(response.key);
                toast.success('API key rotated');
              }}
            >
              Rotate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await revokeKey.mutateAsync(row.original.id);
                toast.success('API key revoked');
              }}
            >
              Revoke
            </Button>
          </div>
        ),
      },
    ],
    [revokeKey, rotateKey],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Access Management"
        description="Create, rotate, and revoke integration API keys with controlled permission scopes."
        breadcrumbs={[{ label: 'Integrations', href: '/app/integrations' }, { label: 'API Keys' }]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Create API Key</CardTitle>
            <CardDescription>Full key is only shown once. Copy and store securely.</CardDescription>
          </div>
          <Button onClick={onSubmit} disabled={createKey.isPending}>Generate Key</Button>
        </CardHeader>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Key Name</label>
            <Input {...form.register('name')} placeholder="Hospital EMR Integration Key" />
            {form.formState.errors.name ? <p className="mt-1 text-xs text-danger">{form.formState.errors.name.message}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Permissions</label>
            <Input {...form.register('permissions')} placeholder="records.read, records.write" />
            {form.formState.errors.permissions ? <p className="mt-1 text-xs text-danger">{form.formState.errors.permissions.message}</p> : null}
          </div>
        </form>
        {issuedKey ? (
          <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-warning">Copy this key now</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">{issuedKey}</p>
          </div>
        ) : null}
      </Card>

      {keysQuery.isError ? (
        <ErrorState title="Unable to load API keys" description="Please retry." onRetry={() => keysQuery.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={pagedRows}
          total={rows.length}
          loading={keysQuery.isLoading || createKey.isPending || rotateKey.isPending || revokeKey.isPending}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(rows.length / pagination.pageSize))}
          searchPlaceholder="Search keys"
        />
      )}
    </div>
  );
}
