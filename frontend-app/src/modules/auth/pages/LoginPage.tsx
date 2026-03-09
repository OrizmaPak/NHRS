import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useLogin } from '@/api/hooks/useLogin';
import { FormField } from '@/components/forms/FormField';
import { PasswordInput } from '@/components/forms/PasswordInput';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';
import type { LoginPayload } from '@/types/auth';

const loginSchema = z.object({
  method: z.enum(['nin', 'email', 'phone']),
  nin: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  password: z.string().min(1, 'Password is required'),
}).superRefine((values, ctx) => {
  if (values.method === 'nin') {
    if (!values.nin || !/^\d{11}$/.test(values.nin)) {
      ctx.addIssue({ code: 'custom', path: ['nin'], message: 'NIN must be exactly 11 digits' });
    }
  }
  if (values.method === 'email') {
    if (!values.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address' });
    }
  }
  if (values.method === 'phone') {
    if (!values.phone || values.phone.trim().length < 8) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a valid phone number' });
    }
  }
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const loginMutation = useLogin();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      method: 'nin',
      nin: '',
      email: '',
      phone: '',
      password: '',
    },
  });
  const method = form.watch('method');
  const switchMethod = (nextMethod: LoginFormValues['method']) => {
    form.setValue('method', nextMethod, { shouldValidate: true });
    if (nextMethod === 'email') {
      form.setValue('email', 'superadmin@nhrs.local', { shouldDirty: true, shouldValidate: true });
      form.setValue('password', 'Admin@1234', { shouldDirty: true, shouldValidate: true });
      form.setValue('nin', '', { shouldDirty: true, shouldValidate: false });
      form.setValue('phone', '', { shouldDirty: true, shouldValidate: false });
    }
  };

  const submitLogin = async (values: LoginFormValues) => {
    const payload: LoginPayload = { method: values.method, password: values.password };
    if (values.method === 'nin') payload.nin = values.nin?.trim();
    if (values.method === 'email') payload.email = values.email?.trim().toLowerCase();
    if (values.method === 'phone') payload.phone = values.phone?.trim();
    await loginMutation.mutateAsync(payload);
  };

  useEffect(() => {
    if (isAuthenticated) {
      navigate(user?.requiresPasswordChange ? '/auth/password/setup' : '/app', { replace: true });
    }
  }, [isAuthenticated, navigate, user?.requiresPasswordChange]);

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-background via-white to-primary/10 px-4 py-8">
      <Card className="w-full max-w-md border-border/70">
        <CardHeader>
          <div>
            <CardTitle>NHRS Secure Login</CardTitle>
            <CardDescription>Sign in with your NHRS identity to access your authorized context.</CardDescription>
          </div>
        </CardHeader>

        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            try {
              await submitLogin(values);
              toast.success('Session initialized');
              const currentUser = useAuthStore.getState().user;
              navigate(currentUser?.requiresPasswordChange ? '/auth/password/setup' : '/app', { replace: true });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to login');
            }
          })}
        >
          <FormField label="Login Method">
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={method === 'nin' ? 'default' : 'outline'}
                onClick={() => switchMethod('nin')}
              >
                NIN
              </Button>
              <Button
                type="button"
                variant={method === 'email' ? 'default' : 'outline'}
                onClick={() => switchMethod('email')}
              >
                Email
              </Button>
              <Button
                type="button"
                variant={method === 'phone' ? 'default' : 'outline'}
                onClick={() => switchMethod('phone')}
              >
                Phone
              </Button>
            </div>
          </FormField>

          {method === 'nin' ? (
            <FormField label="NIN" error={form.formState.errors.nin?.message}>
              <Input
                autoComplete="username"
                inputMode="numeric"
                placeholder="Enter 11-digit NIN"
                {...form.register('nin')}
              />
            </FormField>
          ) : null}

          {method === 'email' ? (
            <FormField label="Email" error={form.formState.errors.email?.message}>
              <Input
                autoComplete="email"
                placeholder="Enter email"
                {...form.register('email')}
              />
            </FormField>
          ) : null}

          {method === 'phone' ? (
            <FormField label="Phone" error={form.formState.errors.phone?.message}>
              <Input
                autoComplete="tel"
                placeholder="Enter phone number"
                {...form.register('phone')}
              />
            </FormField>
          ) : null}

          <FormField label="Password" error={form.formState.errors.password?.message}>
            <PasswordInput
              autoComplete="current-password"
              placeholder={method === 'nin' ? 'DOB (DDMMYYYY) for first login or account password' : 'Enter password'}
              {...form.register('password')}
            />
          </FormField>

          {loginMutation.isError ? (
            <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
              {loginMutation.error instanceof Error ? loginMutation.error.message : 'Authentication failed'}
            </p>
          ) : null}

          <Button type="submit" className="w-full" loading={loginMutation.isPending} loadingText="Signing in...">
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
