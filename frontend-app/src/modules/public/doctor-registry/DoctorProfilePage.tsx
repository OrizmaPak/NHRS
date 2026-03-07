import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export function DoctorProfilePage() {
  const { doctorId = '' } = useParams();

  const profileQuery = useQuery({
    queryKey: ['doctor-profile', doctorId],
    enabled: Boolean(doctorId),
    queryFn: () => apiClient.get<Record<string, unknown>>(endpoints.doctorRegistry.profile(doctorId), { skipAuth: true }),
  });

  const profile = useMemo(() => {
    const raw = profileQuery.data ?? {};
    const affiliations = Array.isArray(raw.affiliations) ? raw.affiliations : [];
    return {
      name: String(raw.fullName ?? raw.name ?? 'Doctor'),
      status: String(raw.status ?? 'pending'),
      specialization: String(raw.specialization ?? 'General practice'),
      licenseNumber: String(raw.licenseNumber ?? 'N/A'),
      licenseAuthority: String(raw.licenseAuthority ?? 'N/A'),
      doctorId: String(raw.doctorId ?? raw.id ?? 'N/A'),
      affiliations,
      affiliationCount: affiliations.length,
    };
  }, [profileQuery.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Doctor Profile"
        description="Public verification details for licensed clinicians."
        breadcrumbs={[{ label: 'Public' }, { label: 'Doctor Registry' }, { label: 'Profile' }]}
      />

      {profileQuery.isLoading ? (
        <div className="space-y-3">
          <LoadingSkeleton className="h-28 w-full" />
          <LoadingSkeleton className="h-24 w-full" />
        </div>
      ) : null}

      {profileQuery.isError ? (
        <ErrorState title="Could not load doctor profile" description="Please retry in a moment." onRetry={() => profileQuery.refetch()} />
      ) : null}

      {!profileQuery.isLoading && !profileQuery.isError ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{profile.name}</CardTitle>
                  <CardDescription>{profile.specialization}</CardDescription>
                </div>
                <StatusBadge status={profile.status} />
              </div>
            </CardHeader>
            <div className="grid gap-3 px-6 pb-6 text-sm md:grid-cols-2 lg:grid-cols-4">
              <p><span className="text-muted">Doctor ID:</span> {profile.doctorId}</p>
              <p><span className="text-muted">License:</span> {profile.licenseNumber}</p>
              <p><span className="text-muted">Authority:</span> {profile.licenseAuthority}</p>
              <p><span className="text-muted">Affiliations:</span> {profile.affiliationCount}</p>
            </div>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Affiliations</CardTitle>
                <CardDescription>Current listed organizations and branches.</CardDescription>
              </div>
            </CardHeader>
            <div className="space-y-2 px-6 pb-6">
              {(profile.affiliations as Array<Record<string, unknown>>).length === 0 ? (
                <p className="text-sm text-muted">No affiliations published.</p>
              ) : (
                (profile.affiliations as Array<Record<string, unknown>>).map((item, index) => (
                  <div key={`${item.orgId ?? 'org'}-${index}`} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">{String(item.orgId ?? 'Organization')}</p>
                    <p className="text-muted">{String(item.branchId ?? 'Main branch')}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
