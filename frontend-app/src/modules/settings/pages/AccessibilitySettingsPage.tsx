import { PageHeader } from '@/components/layout/PageHeader';
import { AccessibilityPanel } from '@/components/theme/AccessibilityPanel';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

export function AccessibilitySettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Accessibility Settings"
        description="Ensure every user can operate NHRS confidently with readable, inclusive defaults."
        breadcrumbs={[{ label: 'Settings' }, { label: 'Accessibility' }]}
      />
      <Card className="shadow-subtle">
        <CardHeader>
          <div>
            <CardTitle>Personal accessibility profile</CardTitle>
            <CardDescription>These preferences apply immediately and persist across sessions.</CardDescription>
          </div>
        </CardHeader>
        <AccessibilityPanel />
      </Card>
    </div>
  );
}
