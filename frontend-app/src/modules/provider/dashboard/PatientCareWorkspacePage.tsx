import { Link } from 'react-router-dom';
import { Building2, HeartPulse, Search, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationScopeKind } from '@/lib/organizationContext';

function getScopeLabel(scopeKind: 'organization' | 'institution' | 'branch' | null): string {
  if (scopeKind === 'branch') return 'Branch Care Workspace';
  if (scopeKind === 'institution') return 'Institution Care Workspace';
  return 'Patient Care Workspace';
}

export function PatientCareWorkspacePage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const scopeKind = getOrganizationScopeKind(activeContext);
  const subtitle = activeContext?.subtitle || 'Organization, institution, or branch care access';

  return (
    <div className="space-y-6">
      <PageHeader
        title={getScopeLabel(scopeKind)}
        description="Search a citizen by NIN, open the patient profile, and review the timeline available to the active organization, institution, or branch care scope."
        breadcrumbs={[{ label: 'Patient Care' }, { label: activeContext?.name || 'Workspace' }]}
      />

      <div className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
        <Card className="border-border/70 bg-gradient-to-br from-surface via-surface to-surface/80">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-primary/20 bg-primary/10 p-3 text-primary">
                <HeartPulse className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>Active Care Scope</CardTitle>
                <CardDescription>{subtitle}</CardDescription>
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-4 text-sm text-muted">
              The Care workspace follows the active organization scope. In organization scope it works across the whole organization. In institution or branch scope it stays focused on that facility context.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/app/care/patients">Search patients</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/care/intake">Patient intake</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-border bg-background p-3 text-foreground">
                  <Search className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <CardTitle>Patient Search</CardTitle>
                  <CardDescription>Find a patient by NIN or name and open the profile from this scope.</CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sky-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <CardTitle>Shared Organization Register</CardTitle>
                  <CardDescription>
                    Patients registered here stay discoverable across the organization, while institution and branch context still controls where care work is being performed.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <CardTitle>Scope-Aware Access</CardTitle>
                  <CardDescription>
                    Patient profile actions in this workspace respect the active organization, institution, or branch context instead of hiding the module by scope.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}
