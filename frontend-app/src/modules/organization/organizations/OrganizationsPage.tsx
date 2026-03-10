import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  Building2,
  History,
  LayoutGrid,
  List,
  Plus,
  ShieldCheck,
  ShieldOff,
  ShieldX,
  Trash2,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormField } from '@/components/forms/FormField';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import {
  type OrganizationRow,
  type OrganizationType,
  useCreateOrganization,
  useOrganizations,
  useRequestOrganizationDeletion,
  useReviewOrganizationApproval,
  useReviewOrganizationDeletion,
  useUploadOrganizationFile,
  useUpdateOrganization,
} from '@/api/hooks/useInstitutions';

const orgSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  type: z.enum(['hospital', 'laboratory', 'pharmacy', 'government', 'emergency', 'catalog']),
  description: z.string().optional(),
  registrationNumber: z.string().optional(),
  ownerType: z.string().optional(),
  foundedAt: z.string().optional(),
  openedAt: z.string().optional(),
  website: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
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
  const [q, setQ] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<OrganizationRow | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<OrganizationRow | null>(null);
  const [approvalDecision, setApprovalDecision] = useState<'approve' | 'decline' | 'revoke'>('approve');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [deleteRequestTarget, setDeleteRequestTarget] = useState<OrganizationRow | null>(null);
  const [deleteRequestReason, setDeleteRequestReason] = useState('');
  const [deleteReviewTarget, setDeleteReviewTarget] = useState<OrganizationRow | null>(null);
  const [deleteReviewDecision, setDeleteReviewDecision] = useState<'approve' | 'decline'>('approve');
  const [deleteReviewNotes, setDeleteReviewNotes] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [cacFile, setCacFile] = useState<File | null>(null);

  const query = useOrganizations({ page: pagination.pageIndex + 1, limit: pagination.pageSize, q: q || undefined });
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();
  const reviewApproval = useReviewOrganizationApproval();
  const requestDeletion = useRequestOrganizationDeletion();
  const reviewDeletion = useReviewOrganizationDeletion();
  const uploadOrgFile = useUploadOrganizationFile();

  const form = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      name: '',
      type: 'hospital',
      description: '',
      registrationNumber: '',
      ownerType: '',
      foundedAt: '',
      openedAt: '',
      website: '',
      state: '',
      lga: '',
    },
  });

  const rows = query.data?.rows ?? [];

  const columns = useMemo<ColumnDef<OrganizationRow>[]>(() => [
    { accessorKey: 'name', header: 'Organization' },
    { accessorKey: 'type', header: 'Type', cell: ({ row }) => cap(row.original.type) },
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
          <Button size="icon" variant="outline" onClick={() => navigate(`/app/organizations/${row.original.organizationId}/staff`)}>
            <Users className="h-4 w-4" />
          </Button>
          {row.original.hqInstitutionId ? (
            <Button size="icon" variant="outline" onClick={() => navigate(`/app/institutions?orgId=${encodeURIComponent(row.original.organizationId)}`)}>
              <Building2 className="h-4 w-4" />
            </Button>
          ) : null}
          <PermissionGate permission="org.update">
            <>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  setApprovalTarget(row.original);
                  setApprovalDecision(row.original.approvalStatus === 'approved' ? 'revoke' : 'approve');
                  setApprovalNotes('');
                }}
                title="Review approval"
              >
                <ShieldCheck className="h-4 w-4" />
              </Button>
              {row.original.lifecycleStatus === 'delete_pending' ? (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    setDeleteReviewTarget(row.original);
                    setDeleteReviewDecision('approve');
                    setDeleteReviewNotes('');
                  }}
                  title="Review deletion request"
                >
                  <ShieldX className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    setDeleteRequestTarget(row.original);
                    setDeleteRequestReason('');
                  }}
                  title="Request deletion"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </>
          </PermissionGate>
        </div>
      ),
    },
  ], [navigate]);

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = {
      name: values.name,
      type: values.type,
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
      const created = await createOrg.mutateAsync(payload);
      orgId = extractOrganizationId(created);
    }

    if (orgId && logoFile) {
      await uploadOrgFile.mutateAsync({ orgId, kind: 'logo', file: logoFile });
    }
    if (orgId && cacFile) {
      await uploadOrgFile.mutateAsync({ orgId, kind: 'cac', file: cacFile });
    }

    setShowModal(false);
    setEditing(null);
    setLogoFile(null);
    setCacFile(null);
    form.reset();
  });

  const openCreateModal = () => {
    setEditing(null);
    setLogoFile(null);
    setCacFile(null);
    form.reset({
      name: '',
      type: 'hospital',
      description: '',
      registrationNumber: '',
      ownerType: '',
      foundedAt: '',
      openedAt: '',
      website: '',
      state: '',
      lga: '',
    });
    setShowModal(true);
  };

  const openEditModal = (row: OrganizationRow) => {
    setEditing(row);
    setLogoFile(null);
    setCacFile(null);
    form.reset({
      name: row.name,
      type: (row.type as OrganizationType) || 'hospital',
      description: row.description || '',
      registrationNumber: row.registrationNumber || '',
      ownerType: row.ownerType || '',
      foundedAt: row.foundedAt ? String(row.foundedAt).slice(0, 10) : '',
      openedAt: row.openedAt ? String(row.openedAt).slice(0, 10) : '',
      website: row.website || '',
      state: row.state === 'N/A' ? '' : row.state,
      lga: row.lga === 'N/A' ? '' : row.lga,
    });
    setShowModal(true);
  };

  const savingForm = createOrg.isPending || updateOrg.isPending || uploadOrgFile.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="Manage organization approval lifecycle and organization metadata."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Organizations' }]}
        actions={(
          <div className="flex flex-wrap gap-2">
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
          </div>
        )}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search organizations" />
        </div>
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

      {query.isError ? (
        <ErrorState title="Unable to load organizations" description="Retry loading organization records." onRetry={() => query.refetch()} />
      ) : viewMode === 'table' ? (
        <DataTable
          columns={columns}
          data={rows}
          total={query.data?.total ?? 0}
          loading={query.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / pagination.pageSize))}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.organizationId} className="border border-border/60">
              <CardHeader className="space-y-4">
                <div className="flex items-center gap-3">
                  <OrganizationLogo row={row} />
                  <div className="min-w-0">
                    <CardTitle className="truncate">{row.name}</CardTitle>
                    <CardDescription>{cap(row.type)}</CardDescription>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/app/organizations/${row.organizationId}`)}>
                    Open
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => navigate(`/app/organizations/${row.organizationId}/staff`)}>
                    <Users className="h-4 w-4" />
                  </Button>
                  {row.hqInstitutionId ? (
                    <Button size="icon" variant="outline" onClick={() => navigate(`/app/institutions?orgId=${encodeURIComponent(row.organizationId)}`)}>
                      <Building2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <StatusBadge status={row.approvalStatus || 'pending'} />
                  <StatusBadge status={row.lifecycleStatus || row.status || 'active'} />
                </div>
                <PermissionGate permission="org.update">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditModal(row)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setApprovalTarget(row);
                        setApprovalDecision(row.approvalStatus === 'approved' ? 'revoke' : 'approve');
                        setApprovalNotes('');
                      }}
                    >
                      <ShieldOff className="h-4 w-4" />
                      Review Approval
                    </Button>
                  </div>
                </PermissionGate>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showModal} onOpenChange={setShowModal} title={editing ? 'Edit Organization' : 'Create Organization'}>
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Organization Name">
              <Input {...form.register('name')} />
            </FormField>
            <FormField label="Organization Type">
              <select className="h-10 w-full rounded-md border border-border px-3 text-sm" {...form.register('type')}>
                <option value="hospital">Hospital</option>
                <option value="laboratory">Laboratory</option>
                <option value="pharmacy">Pharmacy</option>
                <option value="government">Government</option>
                <option value="emergency">Emergency</option>
                <option value="catalog">Catalog</option>
              </select>
            </FormField>
          </div>
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
              <Input {...form.register('state')} />
            </FormField>
            <FormField label="LGA">
              <Input {...form.register('lga')} />
            </FormField>
          </div>
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

      <Modal open={Boolean(approvalTarget)} onOpenChange={(open) => { if (!open) setApprovalTarget(null); }} title="Review Organization Approval">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!approvalTarget) return;
            await reviewApproval.mutateAsync({
              orgId: approvalTarget.organizationId,
              decision: approvalDecision,
              notes: approvalNotes || undefined,
            });
            setApprovalTarget(null);
            setApprovalNotes('');
          }}
        >
          <FormField label="Decision">
            <select
              className="h-10 w-full rounded-md border border-border px-3 text-sm"
              value={approvalDecision}
              onChange={(event) => setApprovalDecision(event.target.value as 'approve' | 'decline' | 'revoke')}
            >
              <option value="approve">Approve</option>
              <option value="decline">Decline</option>
              <option value="revoke">Revoke</option>
            </select>
          </FormField>
          <FormField label="Notes (optional)">
            <Input value={approvalNotes} onChange={(event) => setApprovalNotes(event.target.value)} />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setApprovalTarget(null)}>Cancel</Button>
            <Button type="submit" loading={reviewApproval.isPending}>
              Submit
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

      <Modal open={Boolean(deleteReviewTarget)} onOpenChange={(open) => { if (!open) setDeleteReviewTarget(null); }} title="Review Deletion Request">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!deleteReviewTarget) return;
            await reviewDeletion.mutateAsync({
              orgId: deleteReviewTarget.organizationId,
              decision: deleteReviewDecision,
              notes: deleteReviewNotes || undefined,
            });
            setDeleteReviewTarget(null);
            setDeleteReviewNotes('');
          }}
        >
          <FormField label="Decision">
            <select
              className="h-10 w-full rounded-md border border-border px-3 text-sm"
              value={deleteReviewDecision}
              onChange={(event) => setDeleteReviewDecision(event.target.value as 'approve' | 'decline')}
            >
              <option value="approve">Approve Delete</option>
              <option value="decline">Decline Delete</option>
            </select>
          </FormField>
          <FormField label="Review notes (optional)">
            <Input value={deleteReviewNotes} onChange={(event) => setDeleteReviewNotes(event.target.value)} />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteReviewTarget(null)}>Cancel</Button>
            <Button type="submit" loading={reviewDeletion.isPending}>
              Submit
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
