import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, GitBranch, ShieldCheck, ShieldX, Trash2, Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { usePermissionsStore } from '@/stores/permissionsStore';
import {
  useOrgDetails,
  useOrgInstitutions,
  useRequestOrganizationDeletion,
  useRestoreOrganization,
  useReviewOrganizationApproval,
  useReviewOrganizationDeletion,
  useScopedBranches,
  useUpdateOrganization,
  useUploadOrganizationFile,
} from '@/api/hooks/useInstitutions';
import { useAuditEvents } from '@/api/hooks/useAuditEvents';

const formSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  registrationNumber: z.string().optional(),
  ownerType: z.string().optional(),
  foundedAt: z.string().optional(),
  openedAt: z.string().optional(),
  website: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

function cap(value: string) {
  if (!value) return value;
  return value
    .split(/[_\s-]+/)
    .map((entry) => (entry ? `${entry[0].toUpperCase()}${entry.slice(1)}` : ''))
    .join(' ');
}

export function OrganizationDetailsPage() {
  const { orgId = '' } = useParams();
  const navigate = useNavigate();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const canEdit = hasPermission('org.update');
  const [editOpen, setEditOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState<'approve' | 'decline' | 'revoke'>('approve');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [deleteRequestOpen, setDeleteRequestOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteReviewOpen, setDeleteReviewOpen] = useState(false);
  const [deleteReviewDecision, setDeleteReviewDecision] = useState<'approve' | 'decline'>('approve');
  const [deleteReviewNotes, setDeleteReviewNotes] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [cacFile, setCacFile] = useState<File | null>(null);

  const detailsQuery = useOrgDetails(orgId);
  const institutionsQuery = useOrgInstitutions(orgId);
  const branchesQuery = useScopedBranches({ page: 1, limit: 8, orgId });
  const auditQuery = useAuditEvents({ page: 1, limit: 8, institution: orgId });
  const updateOrg = useUpdateOrganization();
  const reviewApproval = useReviewOrganizationApproval();
  const requestDeletion = useRequestOrganizationDeletion();
  const reviewDeletion = useReviewOrganizationDeletion();
  const restoreOrg = useRestoreOrganization();
  const uploadOrgFile = useUploadOrganizationFile();

  const org = detailsQuery.data?.organization ?? null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
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
    },
  });

  useEffect(() => {
    if (!org) return;
    form.reset({
      name: org.name ?? '',
      description: org.description ?? '',
      registrationNumber: org.registrationNumber ?? '',
      ownerType: org.ownerType ?? '',
      foundedAt: org.foundedAt ? String(org.foundedAt).slice(0, 10) : '',
      openedAt: org.openedAt ? String(org.openedAt).slice(0, 10) : '',
      website: org.website ?? '',
      state: org.state === 'N/A' ? '' : org.state ?? '',
      lga: org.lga === 'N/A' ? '' : org.lga ?? '',
    });
  }, [form, org]);

  const recentInstitutions = useMemo(() => (institutionsQuery.data?.rows ?? []).slice(0, 6), [institutionsQuery.data?.rows]);
  const recentBranches = useMemo(() => (branchesQuery.data?.rows ?? []).slice(0, 8), [branchesQuery.data?.rows]);

  if (!orgId) {
    return <ErrorState title="Organization not found" description="Invalid organization identifier." />;
  }

  if (detailsQuery.isError) {
    return <ErrorState title="Unable to load organization details" description="Retry loading this organization profile." onRetry={() => detailsQuery.refetch()} />;
  }

  if (!org) {
    return <EmptyState title="No organization found" description="This organization may have been removed or you may not have visibility." />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    await updateOrg.mutateAsync({
      orgId: org.organizationId,
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
    });
    if (logoFile) {
      await uploadOrgFile.mutateAsync({ orgId: org.organizationId, kind: 'logo', file: logoFile });
      setLogoFile(null);
    }
    if (cacFile) {
      await uploadOrgFile.mutateAsync({ orgId: org.organizationId, kind: 'cac', file: cacFile });
      setCacFile(null);
    }
    setEditOpen(false);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        description={detailsQuery.data?.viewerScope?.message || 'Organization profile and oversight view.'}
        breadcrumbs={[{ label: 'Organization' }, { label: 'Organizations', href: '/app/organizations' }, { label: org.name }]}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate(`/app/organizations/${org.organizationId}/staff`)}>
              <Users className="h-4 w-4" />
              View Staff
            </Button>
            <Button variant="outline" onClick={() => navigate(`/app/institutions?orgId=${encodeURIComponent(org.organizationId)}`)}>
              <Building2 className="h-4 w-4" />
              View Institutions
            </Button>
            <Button variant="outline" onClick={() => navigate(`/app/branches?orgId=${encodeURIComponent(org.organizationId)}`)}>
              <GitBranch className="h-4 w-4" />
              View Branches
            </Button>
            {canEdit ? <Button variant="outline" onClick={() => setEditOpen(true)}>Edit Organization</Button> : null}
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>Approval status controls whether institutions and branches can operate.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={org.approvalStatus || 'pending'} />
              <StatusBadge status={org.lifecycleStatus || org.status || 'active'} />
            </div>
          </div>
        </CardHeader>
        <div className="grid gap-4 p-6 pt-0 md:grid-cols-2 xl:grid-cols-4">
          <div><p className="text-xs text-muted">Organization ID</p><p className="text-sm text-foreground">{org.organizationId}</p></div>
          <div><p className="text-xs text-muted">Type</p><p className="text-sm text-foreground">{cap(org.type)}</p></div>
          <div><p className="text-xs text-muted">Owner Type</p><p className="text-sm text-foreground">{cap(org.ownerType || 'N/A')}</p></div>
          <div><p className="text-xs text-muted">Registration</p><p className="text-sm text-foreground">{org.registrationNumber || 'Not set'}</p></div>
          <div><p className="text-xs text-muted">Founded</p><p className="text-sm text-foreground">{org.foundedAt ? new Date(org.foundedAt).toLocaleDateString() : 'N/A'}</p></div>
          <div><p className="text-xs text-muted">Opened</p><p className="text-sm text-foreground">{org.openedAt ? new Date(org.openedAt).toLocaleDateString() : 'N/A'}</p></div>
          <div><p className="text-xs text-muted">State</p><p className="text-sm text-foreground">{org.state}</p></div>
          <div><p className="text-xs text-muted">LGA</p><p className="text-sm text-foreground">{org.lga}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">Website</p><p className="text-sm text-foreground">{org.website || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">Logo</p><p className="truncate text-sm text-foreground">{org.logoUrl || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">CAC Document URL</p><p className="truncate text-sm text-foreground">{org.cacDocumentUrl || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-xs text-muted">Description</p><p className="text-sm text-foreground">{org.description || 'No description'}</p></div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border p-6 pt-4">
          <PermissionGate permission="org.update">
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setApprovalDecision(org.approvalStatus === 'approved' ? 'revoke' : 'approve');
                  setApprovalNotes('');
                  setApprovalOpen(true);
                }}
              >
                <ShieldCheck className="h-4 w-4" />
                Review Approval
              </Button>
              {org.lifecycleStatus === 'delete_pending' ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteReviewDecision('approve');
                    setDeleteReviewNotes('');
                    setDeleteReviewOpen(true);
                  }}
                >
                  <ShieldX className="h-4 w-4" />
                  Review Deletion
                </Button>
              ) : org.lifecycleStatus === 'deleted' ? (
                <Button onClick={() => restoreOrg.mutate({ orgId: org.organizationId })} loading={restoreOrg.isPending}>
                  Restore Organization
                </Button>
              ) : (
                <Button variant="outline" onClick={() => { setDeleteReason(''); setDeleteRequestOpen(true); }}>
                  <Trash2 className="h-4 w-4" />
                  Request Deletion
                </Button>
              )}
            </>
          </PermissionGate>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Institutions (Preview)</CardTitle>
            <CardDescription>Click any item to open full institution details.</CardDescription>
          </CardHeader>
          <div className="space-y-2 p-6 pt-0">
            {recentInstitutions.length === 0 ? <p className="text-sm text-muted">No institutions available.</p> : recentInstitutions.map((institution) => (
              <Link key={institution.institutionId} to={`/app/institutions/${institution.institutionId}`} className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:bg-muted/40">
                <span>{institution.name}</span>
                <StatusBadge status={institution.status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Branches (Preview)</CardTitle>
            <CardDescription>View organization branches at a glance.</CardDescription>
          </CardHeader>
          <div className="space-y-2 p-6 pt-0">
            {recentBranches.length === 0 ? <p className="text-sm text-muted">No branches available.</p> : recentBranches.map((branch) => (
              <Link key={branch.branchId} to={`/app/branches/${branch.branchId}`} className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:bg-muted/40">
                <span>{branch.name}</span>
                <StatusBadge status={branch.status} />
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Organization Activity</CardTitle>
          <CardDescription>Audit events for this organization.</CardDescription>
        </CardHeader>
        <div className="space-y-2 p-6 pt-0">
          {auditQuery.isLoading ? <p className="text-sm text-muted">Loading activity...</p> : null}
          {(auditQuery.data?.rows ?? []).length === 0 ? <p className="text-sm text-muted">No recent activity.</p> : (auditQuery.data?.rows ?? []).map((event) => (
            <div key={event.eventId} className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-foreground">{event.action}</p>
              <p className="text-muted">{event.actor} - {new Date(event.timestamp).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Edit Organization">
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Name"><Input {...form.register('name')} /></FormField>
            <FormField label="Registration Number"><Input {...form.register('registrationNumber')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Owner Type"><Input {...form.register('ownerType')} /></FormField>
            <FormField label="Website"><Input {...form.register('website')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Founded Date"><Input type="date" {...form.register('foundedAt')} /></FormField>
            <FormField label="Opened Date"><Input type="date" {...form.register('openedAt')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="State"><Input {...form.register('state')} /></FormField>
            <FormField label="LGA"><Input {...form.register('lga')} /></FormField>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Logo Upload (optional)">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
              />
            </FormField>
            <FormField label="CAC Upload (optional)">
              <Input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => setCacFile(event.target.files?.[0] || null)}
              />
            </FormField>
          </div>
          <FormField label="Description"><Input {...form.register('description')} /></FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={updateOrg.isPending || uploadOrgFile.isPending}>Save</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={approvalOpen} onOpenChange={setApprovalOpen} title="Review Organization Approval">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await reviewApproval.mutateAsync({
              orgId: org.organizationId,
              decision: approvalDecision,
              notes: approvalNotes || undefined,
            });
            setApprovalOpen(false);
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
            <Button type="button" variant="outline" onClick={() => setApprovalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={reviewApproval.isPending}>Submit</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={deleteRequestOpen} onOpenChange={setDeleteRequestOpen} title="Request Organization Deletion">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await requestDeletion.mutateAsync({
              orgId: org.organizationId,
              reason: deleteReason || undefined,
            });
            setDeleteRequestOpen(false);
          }}
        >
          <FormField label="Reason (optional)">
            <Input value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} />
          </FormField>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteRequestOpen(false)}>Cancel</Button>
            <Button type="submit" loading={requestDeletion.isPending}>Request</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal open={deleteReviewOpen} onOpenChange={setDeleteReviewOpen} title="Review Deletion Request">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await reviewDeletion.mutateAsync({
              orgId: org.organizationId,
              decision: deleteReviewDecision,
              notes: deleteReviewNotes || undefined,
            });
            setDeleteReviewOpen(false);
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
            <Button type="button" variant="outline" onClick={() => setDeleteReviewOpen(false)}>Cancel</Button>
            <Button type="submit" loading={reviewDeletion.isPending}>Submit</Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
