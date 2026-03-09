import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { FormField } from '@/components/forms/FormField';
import { PasswordInput } from '@/components/forms/PasswordInput';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/authStore';

const setPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Confirm your new password'),
    firstName: z.string().min(2, 'First name is required'),
    lastName: z.string().min(2, 'Last name is required'),
    otherName: z.string().min(2, 'Other name is required'),
    dob: z.string().min(8, 'Date of birth is required'),
    nationality: z.string().min(2, 'Nationality is required'),
    stateOfOrigin: z.string().min(2, 'State is required'),
    localGovernment: z.string().min(2, 'Local government is required'),
    confirmDetails: z.boolean().refine((value) => value, 'Please confirm your details'),
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
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      otherName: user?.otherName ?? '',
      dob: user?.dob ?? '',
      nationality: user?.nationality ?? 'Nigeria',
      stateOfOrigin: user?.stateOfOrigin ?? 'Lagos',
      localGovernment: user?.localGovernment ?? 'Ikeja',
      confirmDetails: false,
    },
  });

  const ninProfileQuery = useQuery({
    queryKey: ['auth', 'nin-profile', user?.nin ?? 'none'],
    enabled: Boolean(user?.requiresPasswordChange && user?.nin),
    retry: false,
    queryFn: async () => {
      if (!user?.nin) return null;
      return apiClient.get<Record<string, unknown>>(endpoints.auth.ninLookup(user.nin), { suppressGlobalErrors: true, skipAuth: true });
    },
  });

  useEffect(() => {
    if (!ninProfileQuery.data) return;
    const profile = ninProfileQuery.data;
    form.setValue('firstName', String(profile.firstName ?? user?.firstName ?? ''), { shouldValidate: false });
    form.setValue('lastName', String(profile.lastName ?? user?.lastName ?? ''), { shouldValidate: false });
    form.setValue('otherName', String(profile.otherName ?? user?.otherName ?? ''), { shouldValidate: false });
    form.setValue('dob', String(profile.dob ?? user?.dob ?? ''), { shouldValidate: false });
    form.setValue('nationality', String(profile.nationality ?? user?.nationality ?? 'Nigeria'), { shouldValidate: false });
    form.setValue('stateOfOrigin', String(profile.stateOfOrigin ?? profile.state ?? user?.stateOfOrigin ?? 'Lagos'), { shouldValidate: false });
    form.setValue('localGovernment', String(profile.localGovernment ?? profile.lga ?? user?.localGovernment ?? 'Ikeja'), { shouldValidate: false });
  }, [ninProfileQuery.data, form, user]);

  const setPasswordMutation = useMutation({
    mutationFn: async (values: SetPasswordFormValues) =>
      apiClient.post<{ message?: string }>(endpoints.auth.passwordSet, {
        currentPassword: values.dob,
        newPassword: values.newPassword,
        profile: {
          firstName: values.firstName,
          lastName: values.lastName,
          otherName: values.otherName || null,
          dob: values.dob,
          nationality: values.nationality,
          stateOfOrigin: values.stateOfOrigin,
          localGovernment: values.localGovernment,
        },
      }),
    onSuccess: () => {
      setUser(user ? {
        ...user,
        firstName: form.getValues('firstName'),
        lastName: form.getValues('lastName'),
        otherName: form.getValues('otherName') || undefined,
        dob: form.getValues('dob'),
        nationality: form.getValues('nationality'),
        stateOfOrigin: form.getValues('stateOfOrigin'),
        localGovernment: form.getValues('localGovernment'),
        requiresPasswordChange: false,
      } : null);
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
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-background via-white to-primary/10 px-4 py-8 lg:px-8">
      <Card className="w-full max-w-6xl border-border/70">
        <CardHeader className="flex-col items-start">
          <CardTitle>Complete Account Bootstrap</CardTitle>
          <CardDescription>
            Confirm your NIN details and set a new password before continuing.
          </CardDescription>
        </CardHeader>
        <form
          className="space-y-6"
          onSubmit={form.handleSubmit((values) => {
            void setPasswordMutation.mutateAsync(values);
          })}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3">
            <FormField label={<>First Name <span className="text-danger">*</span></>} error={form.formState.errors.firstName?.message}>
              <Input placeholder="First name" {...form.register('firstName')} />
            </FormField>
            <FormField label={<>Last Name <span className="text-danger">*</span></>} error={form.formState.errors.lastName?.message}>
              <Input placeholder="Last name" {...form.register('lastName')} />
            </FormField>
            <FormField label={<>Other Name <span className="text-danger">*</span></>} error={form.formState.errors.otherName?.message}>
              <Input placeholder="Other name" {...form.register('otherName')} />
            </FormField>
            <FormField label={<>Date of Birth (DDMMYYYY) <span className="text-danger">*</span></>} error={form.formState.errors.dob?.message}>
              <Input placeholder="Will auto-fill from old password if empty" {...form.register('dob')} />
            </FormField>
            <FormField label={<>Nationality <span className="text-danger">*</span></>} error={form.formState.errors.nationality?.message}>
              <Input placeholder="Nationality" {...form.register('nationality')} />
            </FormField>
            <FormField label={<>State of Origin <span className="text-danger">*</span></>} error={form.formState.errors.stateOfOrigin?.message}>
              <Input placeholder="State" {...form.register('stateOfOrigin')} />
            </FormField>
            <FormField label={<>Local Government <span className="text-danger">*</span></>} error={form.formState.errors.localGovernment?.message}>
              <Input placeholder="Local government" {...form.register('localGovernment')} />
            </FormField>
            <FormField label={<>New Password <span className="text-danger">*</span></>} error={form.formState.errors.newPassword?.message}>
              <PasswordInput autoComplete="new-password" placeholder="Minimum 8 characters" {...form.register('newPassword')} />
            </FormField>
            <FormField label={<>Confirm Password <span className="text-danger">*</span></>} error={form.formState.errors.confirmPassword?.message}>
              <PasswordInput autoComplete="new-password" placeholder="Re-enter new password" {...form.register('confirmPassword')} />
            </FormField>
          </div>
          <label className="flex items-start gap-2 rounded border border-border p-2 text-sm text-foreground">
            <input type="checkbox" className="mt-1" {...form.register('confirmDetails')} />
            <span>I confirm these details are correct and belong to me.</span>
          </label>
          {form.formState.errors.confirmDetails ? (
            <p className="text-xs text-danger">{form.formState.errors.confirmDetails.message}</p>
          ) : null}

          <Button type="submit" className="w-full" loading={setPasswordMutation.isPending} loadingText="Saving password...">
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
