import { Eye, Lock, Search, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useContextStore } from '@/stores/contextStore';

function CarePreviewNotice() {
  const activeContext = useContextStore((state) => state.activeContext);

  return (
    <Card className="border-amber-300 bg-amber-50 text-amber-950">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-amber-300 bg-white/70 p-3 text-amber-700">
            <Eye className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <CardTitle>Preview Only In Organization Context</CardTitle>
            <CardDescription className="text-amber-900">
              These Care screens are visible here so organization owners and super staff can understand what the institution and branch workflow looks like.
              They are not operational at the organization level. Switch into an institution or branch context to use them.
            </CardDescription>
          </div>
        </div>
        <div className="rounded-lg border border-amber-300/80 bg-white/60 p-3 text-sm">
          Active context: {activeContext?.name || 'Organization'}.
          Care operations such as patient search, intake, and profile review remain disabled until you move into a facility-level context.
        </div>
      </CardHeader>
    </Card>
  );
}

export function CarePatientSearchPreviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Search"
        description="Preview of the institution and branch patient search experience."
        breadcrumbs={[{ label: 'Patient Care' }, { label: 'Patient Search' }]}
      />

      <CarePreviewNotice />

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-[1.4fr,1fr,auto]">
          <Input disabled placeholder="Patient name" />
          <Input disabled placeholder="NIN" />
          <Button disabled>Patient Intake</Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          In institution or branch context, this page is used to find patients already added into the care register and open the patient profile.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-border bg-background p-3 text-foreground">
              <Search className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle>What This Screen Does</CardTitle>
              <CardDescription>
                Staff use this screen to search patients within the current care scope and open patient profiles, timelines, and treatment context.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}

export function CarePatientIntakePreviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Intake"
        description="Preview of the institution and branch patient intake workflow."
        breadcrumbs={[{ label: 'Patient Care' }, { label: 'Patient Intake' }]}
      />

      <CarePreviewNotice />

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Input disabled placeholder="Enter patient NIN" />
          <Input disabled placeholder="Institution or branch attribution" />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button disabled>Search Patient</Button>
          <Button disabled variant="outline">Register Into Care</Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          In institution or branch context, staff use this screen to look up a patient by NIN, confirm the patient details, and add the patient into the care register.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-border bg-background p-3 text-foreground">
              <UserPlus className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle>Why It Is Disabled Here</CardTitle>
              <CardDescription>
                Patient intake affects the live care register, so it is available only when the user is working inside a specific institution or branch context.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}

export function CarePatientProfilePreviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Profile"
        description="Preview of the patient profile and care timeline view."
        breadcrumbs={[{ label: 'Patient Care' }, { label: 'Patient Search' }, { label: 'Profile' }]}
      />

      <CarePreviewNotice />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-foreground">Patient profile preview</h2>
            <p className="text-sm text-muted">Patient identity and timeline stay unavailable in organization scope.</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3 text-muted">
            <Lock className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Input disabled value="Age: --" />
          <Input disabled value="Gender: --" />
          <Button disabled variant="outline">Export Timeline</Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          In institution or branch context, this page shows the patient summary and the care timeline available to that active facility scope.
        </p>
      </Card>
    </div>
  );
}
