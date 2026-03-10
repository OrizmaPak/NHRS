import { useState } from 'react';
import type { PaginationState } from '@tanstack/react-table';
import { History, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { useDeletedOrganizations, useRestoreOrganization } from '@/api/hooks/useInstitutions';

export function DeletedOrganizationsPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const deletedQuery = useDeletedOrganizations({ page: pagination.pageIndex + 1, limit: pagination.pageSize });
  const restoreOrg = useRestoreOrganization();

  const rows = deletedQuery.data?.rows ?? [];
  const total = deletedQuery.data?.total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deleted Organizations"
        description="Restore deleted organizations, including their institutions, branches, and archived staff assignments."
        breadcrumbs={[{ label: 'Organization' }, { label: 'Deleted Organizations' }]}
      />

      {deletedQuery.isError ? (
        <ErrorState
          title="Unable to load deleted organizations"
          description="Retry loading deleted hierarchy records."
          onRetry={() => deletedQuery.refetch()}
        />
      ) : rows.length === 0 && !deletedQuery.isLoading ? (
        <EmptyState
          title="No deleted organizations"
          description="Deleted organizations will appear here for approval-led restoration."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.organizationId}>
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{row.name}</CardTitle>
                    <CardDescription>{row.organizationId}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={row.approvalStatus || 'approved'} />
                    <StatusBadge status={row.lifecycleStatus || row.status || 'deleted'} />
                  </div>
                </div>
                <div className="grid gap-2 text-sm text-muted md:grid-cols-3">
                  <p><span className="text-foreground">Deleted at:</span> {row.deletedAt ? new Date(row.deletedAt).toLocaleString() : 'N/A'}</p>
                  <p><span className="text-foreground">Institutions:</span> {row.institutions?.length || 0}</p>
                  <p><span className="text-foreground">Branches:</span> {row.branches?.length || 0}</p>
                </div>

                {(row.institutions?.length || 0) > 0 ? (
                  <div className="space-y-1 rounded-md border border-border/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Institutions</p>
                    <div className="flex flex-wrap gap-2">
                      {(row.institutions || []).map((institution) => (
                        <span key={institution.institutionId} className="rounded border border-border px-2 py-1 text-xs text-foreground">
                          {institution.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {(row.branches?.length || 0) > 0 ? (
                  <div className="space-y-1 rounded-md border border-border/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Branches</p>
                    <div className="flex flex-wrap gap-2">
                      {(row.branches || []).map((branch) => (
                        <span key={branch.branchId} className="rounded border border-border px-2 py-1 text-xs text-foreground">
                          {branch.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <PermissionGate permission="org.update">
                  <div className="flex justify-end">
                    <Button
                      onClick={() => restoreOrg.mutate({ orgId: row.organizationId })}
                      loading={restoreOrg.isPending}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore Organization
                    </Button>
                  </div>
                </PermissionGate>
              </CardHeader>
            </Card>
          ))}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              disabled={pagination.pageIndex <= 0}
              onClick={() => setPagination((prev) => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted">Page {pagination.pageIndex + 1} of {pageCount}</span>
            <Button
              variant="outline"
              disabled={pagination.pageIndex + 1 >= pageCount}
              onClick={() => setPagination((prev) => ({ ...prev, pageIndex: Math.min(pageCount - 1, prev.pageIndex + 1) }))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
