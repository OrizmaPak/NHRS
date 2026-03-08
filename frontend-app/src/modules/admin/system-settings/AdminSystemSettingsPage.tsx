import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { useSystemSettings, useSaveSystemSettings } from '@/api/hooks/useSystemSettings';

export function AdminSystemSettingsPage() {
  const settingsQuery = useSystemSettings();
  const saveSettings = useSaveSystemSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin · System Settings"
        description="Platform-level settings registry for operational defaults and controls."
        breadcrumbs={[{ label: 'Admin' }, { label: 'System Settings' }]}
        actions={
          <Button
            onClick={async () => {
              await saveSettings.mutateAsync({ groups: settingsQuery.data ?? [] });
            }}
            disabled={saveSettings.isPending || settingsQuery.isLoading}
          >
            Save Settings
          </Button>
        }
      />

      {settingsQuery.isLoading ? (
        <div className="space-y-3">
          <LoadingSkeleton className="h-28 w-full" />
          <LoadingSkeleton className="h-28 w-full" />
        </div>
      ) : null}

      {settingsQuery.isError ? (
        <ErrorState title="Unable to load settings" description="Please retry." onRetry={() => settingsQuery.refetch()} />
      ) : null}

      {!settingsQuery.isLoading && !settingsQuery.isError ? (
        <div className="space-y-4">
          {(settingsQuery.data ?? []).map((group) => (
            <Card key={group.id}>
              <CardHeader>
                <div>
                  <CardTitle>{group.title}</CardTitle>
                  <CardDescription>Editable configuration values grouped by function.</CardDescription>
                </div>
              </CardHeader>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {group.settings.map((setting) => (
                  <div key={setting.key}>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{setting.key}</label>
                    <Input value={String(setting.value)} readOnly />
                    {setting.description ? <p className="mt-1 text-xs text-muted">{setting.description}</p> : null}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
