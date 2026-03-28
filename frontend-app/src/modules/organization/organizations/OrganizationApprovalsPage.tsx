import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ShieldX, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/data/FilterBar';
import { SearchInput } from '@/components/data/SearchInput';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import {
  type OrganizationRow,
  useOrganizations,
  useReviewOrganizationDeletion,
  useReviewOrganizationApproval,
} from '@/api/hooks/useInstitutions';
import { usePermissionsStore } from '@/stores/permissionsStore';

export function OrganizationApprovalsPage() {
  const navigate = useNavigate();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const canListAll = hasPermission('org.list_all');

  const [q, setQ] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'affiliated' | 'all'>('affiliated');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'pending' | 'approved' | 'declined' | 'revoked'>('all');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const [target, setTarget] = useState<OrganizationRow | null>(null);
  const [decision, setDecision] = useState<'approve' | 'decline' | 'revoke'>('approve');
  const [notes, setNotes] = useState('');
  const [deletionTarget, setDeletionTarget] = useState<OrganizationRow | null>(null);
  const [deletionDecision, setDeletionDecision] = useState<'approve' | 'decline'>('approve');
  const [deletionNotes, setDeletionNotes] = useState('');

  const effectiveScopeFilter: 'affiliated' | 'all' = canListAll ? scopeFilter : 'affiliated';

  const query = useOrganizations({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    q: q || undefined,
    scope: effectiveScopeFilter,
    approvalStatus: approvalFilter === 'all' ? undefined : approvalFilter,
  });
  const reviewApproval = useReviewOrganizationApproval();
  const reviewDeletion = useReviewOrganizationDeletion();
  const rows = query.data?.rows ?? [];

  const columns = useMemo<ColumnDef<OrganizationRow>[]>(() => [
    { accessorKey: 'name', header: 'Organization' },
    { accessorKey: 'state', header: 'State' },
    { accessorKey: 'lga', header: 'LGA' },
    {
      accessorKey: 'approvalStatus',
      header: 'Approval',
      cell: ({ row }) => <StatusBadge status={row.original.approvalStatus || 'pending'} />,
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ row }) => (row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleString() : 'N/A'),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/app/organizations/${row.original.organizationId}`)}>
            Open
          </Button>
          <PermissionGate permission="org.update">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTarget(row.original);
                  setDecision(row.original.approvalStatus === 'approved' ? 'revoke' : 'approve');
                  setNotes('');
                }}
              >
                <CheckCircle2 className="h-4 w-4" />
                Review Approval
              </Button>
              {row.original.lifecycleStatus === 'delete_pending' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDeletionTarget(row.original);
                    setDeletionDecision('approve');
                    setDeletionNotes('');
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Review Delete
                </Button>
              ) : null}
            </div>
          </PermissionGate>
        </div>
      ),
    },
  ], [navigate]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Approvals"
        description="Review approval states for organizations. Approvals are managed here, separate from organization management."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Approvals' }]}
      />

      <FilterBar>
        <div className="w-full md:max-w-sm">
          <SearchInput value={q} onChange={setQ} placeholder="Search organizations" />
        </div>
        <div className="inline-flex rounded-md border border-border p-1">
          <Button
            variant={scopeFilter === 'affiliated' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setScopeFilter('affiliated')}
          >
            My Organizations
          </Button>
          {canListAll ? (
            <Button
              variant={scopeFilter === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setScopeFilter('all')}
            >
              All Organizations
            </Button>
          ) : null}
        </div>
        <select
          className="h-10 rounded-md border border-border px-3 text-sm"
          value={approvalFilter}
          onChange={(event) => setApprovalFilter(event.target.value as 'all' | 'pending' | 'approved' | 'declined' | 'revoked')}
        >
          <option value="all">All Approval States</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
          <option value="revoked">Revoked</option>
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setApprovalFilter('all');
            setQ('');
          }}
        >
          Reset
        </Button>
      </FilterBar>

      {query.isError ? (
        <ErrorState
          title="Unable to load organization approvals"
          description="Retry loading approval records."
          onRetry={() => query.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          total={query.data?.total ?? 0}
          loading={query.isLoading}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / pagination.pageSize))}
        />
      )}

      <Modal open={Boolean(target)} onOpenChange={(open) => { if (!open) setTarget(null); }} title="Review Organization Approval">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!target) return;
            try {
              await reviewApproval.mutateAsync({
                orgId: target.organizationId,
                decision,
                notes: notes || undefined,
              });
              toast.success('Organization approval updated');
              setTarget(null);
              setNotes('');
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to review organization approval');
            }
          }}
        >
          <FormField label="Decision">
            <select
              className="h-10 w-full rounded-md border border-border px-3 text-sm"
              value={decision}
              onChange={(event) => setDecision(event.target.value as 'approve' | 'decline' | 'revoke')}
            >
              <option value="approve">Approve</option>
              <option value="decline">Decline</option>
              <option value="revoke">Revoke</option>
            </select>
          </FormField>
          <FormField label="Notes (optional)">
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted">
            <ShieldX className="mr-1 inline h-3 w-3" />
            Revoking approval suspends operational write/read timeline activity under this organization hierarchy.
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={reviewApproval.isPending}>
              Submit
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={Boolean(deletionTarget)} onOpenChange={(open) => { if (!open) setDeletionTarget(null); }} title="Review Organization Deletion">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!deletionTarget) return;
            try {
              await reviewDeletion.mutateAsync({
                orgId: deletionTarget.organizationId,
                decision: deletionDecision,
                notes: deletionNotes || undefined,
              });
              toast.success('Organization deletion review updated');
              setDeletionTarget(null);
              setDeletionNotes('');
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to review organization deletion');
            }
          }}
        >
          <FormField label="Decision">
            <select
              className="h-10 w-full rounded-md border border-border px-3 text-sm"
              value={deletionDecision}
              onChange={(event) => setDeletionDecision(event.target.value as 'approve' | 'decline')}
            >
              <option value="approve">Approve Deletion</option>
              <option value="decline">Decline Deletion</option>
            </select>
          </FormField>
          <FormField label="Notes (optional)">
            <Input value={deletionNotes} onChange={(event) => setDeletionNotes(event.target.value)} />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setDeletionTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={reviewDeletion.isPending}>
              Submit
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
