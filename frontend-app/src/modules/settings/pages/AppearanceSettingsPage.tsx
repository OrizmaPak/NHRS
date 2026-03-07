import { PageHeader } from '@/components/layout/PageHeader';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { AccessibilityPanel } from '@/components/theme/AccessibilityPanel';
import { ThemeEditor } from '@/components/theme/ThemeEditor';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

export function AppearanceSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Appearance Settings"
        description="Configure runtime design tokens and accessibility overrides for the active context."
        breadcrumbs={[{ label: 'Settings' }, { label: 'Appearance' }]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <PermissionGate permission={['ui.theme.update', 'organization.admin', 'state.admin', 'taskforce.admin']}>
          <Card className="shadow-subtle">
            <CardHeader>
              <div>
                <CardTitle>Runtime theme editor</CardTitle>
                <CardDescription>Primary, secondary, accent, surface, text, typography, and logos.</CardDescription>
              </div>
            </CardHeader>
            <ThemeEditor />
          </Card>
        </PermissionGate>

        <Card className="shadow-subtle">
          <CardHeader>
            <div>
              <CardTitle>Accessibility controls</CardTitle>
              <CardDescription>User preferences override context defaults and persist locally.</CardDescription>
            </div>
          </CardHeader>
          <AccessibilityPanel />
        </Card>
      </div>
    </div>
  );
}
