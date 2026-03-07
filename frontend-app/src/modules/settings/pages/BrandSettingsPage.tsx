import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { FormField } from '@/components/forms/FormField';
import { LogoUploader } from '@/components/forms/LogoUploader';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useThemeStore } from '@/stores/themeStore';

const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/i, 'Use a HEX color');

const schema = z.object({
  primary: hex,
  secondary: hex,
  accent: hex,
  surface: hex,
  text: hex,
});

type FormValues = z.infer<typeof schema>;

export function BrandSettingsPage() {
  const theme = useThemeStore((state) => state.resolvedTheme);
  const contextTheme = useThemeStore((state) => state.contextTheme);
  const applyTheme = useThemeStore((state) => state.applyTheme);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      primary: theme.tokens.colors.primary,
      secondary: theme.tokens.colors.secondary,
      accent: theme.tokens.colors.accent,
      surface: theme.tokens.colors.surface,
      text: theme.tokens.colors.text,
    },
  });

  useEffect(() => {
    form.reset({
      primary: theme.tokens.colors.primary,
      secondary: theme.tokens.colors.secondary,
      accent: theme.tokens.colors.accent,
      surface: theme.tokens.colors.surface,
      text: theme.tokens.colors.text,
    });
  }, [form, theme]);

  const onSubmit = async (values: FormValues) => {
    const next = {
      ...theme,
      tokens: {
        ...theme.tokens,
        colors: {
          ...theme.tokens.colors,
          ...values,
        },
      },
    };
    applyTheme(next);
    if (contextTheme?.id) {
      await apiClient.patch(endpoints.uiTheme.update(contextTheme.id), {
        themeTokens: next.tokens,
        theme_tokens: next.tokens,
      });
    }
    toast.success('Brand saved');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brand Settings"
        description="Customize colors and logos for the active organization, state, or taskforce context."
        breadcrumbs={[{ label: 'Settings' }, { label: 'Brand' }]}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Brand tokens</CardTitle>
              <CardDescription>Adjust identity colors with real-time preview and save to backend.</CardDescription>
            </div>
          </CardHeader>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(['primary', 'secondary', 'accent', 'surface', 'text'] as const).map((field) => (
                <FormField key={field} label={`${field[0].toUpperCase()}${field.slice(1)} color`} error={form.formState.errors[field]?.message}>
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      value={form.watch(field)}
                      onChange={(event) => form.setValue(field, event.target.value, { shouldValidate: true })}
                      className="h-10 w-12 p-1"
                    />
                    <Input {...form.register(field)} />
                  </div>
                </FormField>
              ))}
            </div>

            <LogoUploader
              themeId={contextTheme?.id}
              value={{
                lightUrl: theme.tokens.logo.lightUrl,
                darkUrl: theme.tokens.logo.darkUrl,
                markUrl: theme.tokens.logo.markUrl,
              }}
        onChange={async (logo) => {
          const next = {
            ...theme,
            tokens: {
              ...theme.tokens,
              logo: {
                lightUrl: logo.lightUrl ?? theme.tokens.logo.lightUrl,
                darkUrl: logo.darkUrl ?? theme.tokens.logo.darkUrl,
                markUrl: logo.markUrl ?? theme.tokens.logo.markUrl,
              },
            },
          };

          applyTheme(next);
          if (contextTheme?.id) {
            try {
              await apiClient.patch(endpoints.uiTheme.update(contextTheme.id), {
                themeTokens: next.tokens,
                theme_tokens: next.tokens,
              });
            } catch {
              toast.error('Logo uploaded but brand save failed.');
            }
          }
        }}
      />

            <div className="flex justify-end">
              <Button type="submit">Save brand</Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Live preview</CardTitle>
              <CardDescription>See how cards and actions inherit your brand tokens.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3 rounded-lg border border-border bg-background p-4">
            <div className="rounded-lg border border-border bg-surface p-4 shadow-subtle">
              <p className="text-sm font-semibold text-foreground">Provider workspace card</p>
              <p className="mt-1 text-sm text-muted">Theme updates are applied instantly across shell and modules.</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm">Primary action</Button>
                <Button size="sm" variant="outline">Secondary</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
