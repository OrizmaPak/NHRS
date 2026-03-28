import { useMemo, useState } from 'react';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { usePublicOrganizationDetails, type InstitutionRow, type BranchRow } from '@/api/hooks/useInstitutions';

export function OrganizationPublicDetailsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const query = usePublicOrganizationDetails(orgId);
  const [institutionPagination, setInstitutionPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [branchPagination, setBranchPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

  const institutionColumns = useMemo<ColumnDef<InstitutionRow>[]>(() => [
    { accessorKey: 'name', header: 'Institution' },
    { accessorKey: 'type', header: 'Type' },
    { accessorKey: 'state', header: 'State' },
    { accessorKey: 'lga', header: 'LGA' },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ], []);

  const branchColumns = useMemo<ColumnDef<BranchRow>[]>(() => [
    { accessorKey: 'name', header: 'Branch' },
    { accessorKey: 'type', header: 'Type' },
    { accessorKey: 'state', header: 'State' },
    { accessorKey: 'lga', header: 'LGA' },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ], []);

  if (!orgId) {
    return <ErrorState title="Organization not found" description="Invalid organization identifier." />;
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Unable to load organization profile"
        description="Please retry."
        onRetry={() => query.refetch()}
      />
    );
  }

  const organization = query.data?.organization;
  if (!query.isLoading && !organization) {
    return <ErrorState title="Organization not found" description="This organization profile is unavailable." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={organization?.name || 'Organization'}
        description="Public profile and listed institutions/branches."
        breadcrumbs={[
          { label: 'Public', href: '/app/public/organizations' },
          { label: 'Organizations', href: '/app/public/organizations' },
          { label: organization?.name || 'Profile' },
        ]}
        actions={(
          <Link className="text-sm font-medium text-primary hover:underline" to="/app/public/organizations">
            Back to directory
          </Link>
        )}
      />

      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Organization Profile</CardTitle>
          <CardDescription>Published public information from the organization.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-muted">Registration Number</p>
            <p className="text-sm text-foreground">{organization?.registrationNumber || 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Location</p>
            <p className="text-sm text-foreground">{organization ? `${organization.state}, ${organization.lga}` : 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Website</p>
            <p className="text-sm text-foreground">{organization?.website || 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Status</p>
            <StatusBadge status={organization?.lifecycleStatus || organization?.status || 'active'} />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted">Public Information</p>
            <p className="text-sm text-foreground">{organization?.publicInfo || 'No public information published.'}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted">Opening Hours</p>
            <p className="text-sm text-foreground">{organization?.openingHours || 'Not published'}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Institutions</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={institutionColumns}
            data={query.data?.institutions ?? []}
            total={query.data?.institutions.length ?? 0}
            loading={query.isLoading}
            pagination={institutionPagination}
            onPaginationChange={setInstitutionPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.institutions.length ?? 0) / institutionPagination.pageSize))}
          />
        </CardContent>
      </Card>

      <Card className="border border-border/60">
        <CardHeader>
          <CardTitle>Branches</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={branchColumns}
            data={query.data?.branches ?? []}
            total={query.data?.branches.length ?? 0}
            loading={query.isLoading}
            pagination={branchPagination}
            onPaginationChange={setBranchPagination}
            pageCount={Math.max(1, Math.ceil((query.data?.branches.length ?? 0) / branchPagination.pageSize))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

