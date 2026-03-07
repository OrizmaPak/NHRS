import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { FormField } from '@/components/forms/FormField';
import { LogoUploader } from '@/components/forms/LogoUploader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useThemeStore } from '@/stores/themeStore';

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/i, 'Use valid HEX color');

const schema = z.object({
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  surface: hexColor,
  background: hexColor,
  text: hexColor,
  fontFamily: z.string().min(2),
});

type FormValues = z.infer<typeof schema>;

export function ThemeEditor() {
  const theme = useThemeStore((state) => state.resolvedTheme);
  const applyTheme = useThemeStore((state) => state.applyTheme);
  const contextTheme = useThemeStore((state) => state.contextTheme);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      primary: theme.tokens.colors.primary,
      secondary: theme.tokens.colors.secondary,
      accent: theme.tokens.colors.accent,
      surface: theme.tokens.colors.surface,
      background: theme.tokens.colors.background,
      text: theme.tokens.colors.text,
      fontFamily: theme.tokens.typography.fontFamily,
    },
  });

  useEffect(() => {
    form.reset({
      primary: theme.tokens.colors.primary,
      secondary: theme.tokens.colors.secondary,
      accent: theme.tokens.colors.accent,
      surface: theme.tokens.colors.surface,
      background: theme.tokens.colors.background,
      text: theme.tokens.colors.text,
      fontFamily: theme.tokens.typography.fontFamily,
    });
  }, [form, theme]);

  const onSubmit = async (values: FormValues) => {
    const next = {
      ...theme,
      tokens: {
        ...theme.tokens,
        colors: {
          ...theme.tokens.colors,
          primary: values.primary,
          secondary: values.secondary,
          accent: values.accent,
          surface: values.surface,
          background: values.background,
          text: values.text,
        },
        typography: {
          ...theme.tokens.typography,
          fontFamily: values.fontFamily,
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
        // keep local preview even if save fails
      }
    }
    toast.success('Theme updated');
  };

  return (
    <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Primary color" error={form.formState.errors.primary?.message}>
          <Input {...form.register('primary')} />
        </FormField>
        <FormField label="Secondary color" error={form.formState.errors.secondary?.message}>
          <Input {...form.register('secondary')} />
        </FormField>
        <FormField label="Accent color" error={form.formState.errors.accent?.message}>
          <Input {...form.register('accent')} />
        </FormField>
        <FormField label="Surface color" error={form.formState.errors.surface?.message}>
          <Input {...form.register('surface')} />
        </FormField>
        <FormField label="Background color" error={form.formState.errors.background?.message}>
          <Input {...form.register('background')} />
        </FormField>
        <FormField label="Text color" error={form.formState.errors.text?.message}>
          <Input {...form.register('text')} />
        </FormField>
      </div>

      <FormField label="Base font family" error={form.formState.errors.fontFamily?.message}>
        <Input {...form.register('fontFamily')} />
      </FormField>

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
              toast.error('Logo uploaded but theme token save failed.');
            }
          }
        }}
      />

      <div className="flex justify-end">
        <Button type="submit">Save theme</Button>
      </div>
    </form>
  );
}
