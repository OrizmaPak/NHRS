import { z } from 'zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { useSystemSettings, useSaveSystemSettings } from '@/api/hooks/useSystemSettings';

const configSchema = z.object({
  defaultTheme: z.string().min(1),
  notificationsEnabled: z.boolean(),
  emergencyAlertThreshold: z.number().min(1),
  featureFlags: z.string(),
});

type ConfigValues = z.infer<typeof configSchema>;

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  if (typeof value === 'number') return value > 0;
  return false;
}

export function SystemConfigurationPage() {
  const settingsQuery = useSystemSettings();
  const saveSettings = useSaveSystemSettings();
  const form = useForm<ConfigValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      defaultTheme: 'platform-default',
      notificationsEnabled: true,
      emergencyAlertThreshold: 10,
      featureFlags: '',
    },
  });

  useEffect(() => {
    if (!settingsQuery.data?.length) return;
    const allSettings = settingsQuery.data.flatMap((group) => group.settings);
    form.reset({
      defaultTheme: String(allSettings.find((entry) => entry.key === 'defaultTheme')?.value ?? 'platform-default'),
      notificationsEnabled: toBoolean(allSettings.find((entry) => entry.key === 'notificationsEnabled')?.value ?? true),
      emergencyAlertThreshold: Number(allSettings.find((entry) => entry.key === 'emergencyAlertThreshold')?.value ?? 10),
      featureFlags: String(allSettings.find((entry) => entry.key === 'featureFlags')?.value ?? ''),
    });
  }, [form, settingsQuery.data]);

  const onSubmit = form.handleSubmit(async (values) => {
    await saveSettings.mutateAsync({
      groups: [
        {
          id: 'system-configuration',
          title: 'System Configuration',
          settings: [
            { key: 'defaultTheme', value: values.defaultTheme, description: 'System fallback theme scope' },
            { key: 'notificationsEnabled', value: values.notificationsEnabled, description: 'Enable notification fanout' },
            { key: 'emergencyAlertThreshold', value: values.emergencyAlertThreshold, description: 'Threshold for critical alerting' },
            { key: 'featureFlags', value: values.featureFlags, description: 'Comma-separated feature flags' },
          ],
        },
      ],
    });
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Configuration"
        description="Manage default theme, alert thresholds, notifications, and feature flags."
        breadcrumbs={[{ label: 'System' }, { label: 'Configuration' }]}
      />

      {settingsQuery.isLoading ? <LoadingSkeleton className="h-72 w-full" /> : null}
      {settingsQuery.isError ? (
        <ErrorState title="Unable to load system configuration" description="Please retry." onRetry={() => settingsQuery.refetch()} />
      ) : null}

      {!settingsQuery.isLoading && !settingsQuery.isError ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Configuration Controls</CardTitle>
              <CardDescription>Changes are applied globally after save.</CardDescription>
            </div>
            <Button onClick={onSubmit} loading={saveSettings.isPending} loadingText="Saving configuration...">
              Save Configuration
            </Button>
          </CardHeader>
          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Default Theme</label>
              <Input {...form.register('defaultTheme')} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Emergency Alert Threshold</label>
              <Input type="number" {...form.register('emergencyAlertThreshold', { valueAsNumber: true })} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Feature Flags</label>
              <Input {...form.register('featureFlags')} placeholder="flag_a,flag_b" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="h-4 w-4 rounded border border-border" {...form.register('notificationsEnabled')} />
              Notifications enabled
            </label>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
