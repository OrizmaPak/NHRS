import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';

const setPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Confirm your new password'),
  })
  .superRefine((values, ctx) => {
    if (values.newPassword !== values.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
        path: ['confirmPassword'],
      });
    }
  });

type SetPasswordFormValues = z.infer<typeof setPasswordSchema>;

export function SetPasswordPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const form = useForm<SetPasswordFormValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    },
  });

  const setPasswordMutation = useMutation({
    mutationFn: async (values: SetPasswordFormValues) =>
      apiClient.post<{ message?: string }>(endpoints.auth.passwordSet, { newPassword: values.newPassword }),
    onSuccess: () => {
      setUser(user ? { ...user, requiresPasswordChange: false } : null);
      toast.success('Password updated successfully');
      navigate('/app', { replace: true });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Unable to set password');
    },
  });

  if (!user?.requiresPasswordChange) {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-background via-white to-primary/10 px-4 py-8">
      <Card className="w-full max-w-md border-border/70">
        <CardHeader className="flex-col items-start">
          <CardTitle>Set New Password</CardTitle>
          <CardDescription>
            This account requires a password update before you can continue to your dashboard.
          </CardDescription>
        </CardHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => {
            void setPasswordMutation.mutateAsync(values);
          })}
        >
          <FormField label="New Password" error={form.formState.errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" placeholder="Minimum 8 characters" {...form.register('newPassword')} />
          </FormField>
          <FormField label="Confirm Password" error={form.formState.errors.confirmPassword?.message}>
            <Input type="password" autoComplete="new-password" placeholder="Re-enter new password" {...form.register('confirmPassword')} />
          </FormField>

          <Button type="submit" className="w-full" loading={setPasswordMutation.isPending} loadingText="Saving password...">
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
