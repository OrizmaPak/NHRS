import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, ApiClientError } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { meQueryKey, useMe } from '@/api/hooks/useMe';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import { getOrganizationScopeKind } from '@/lib/organizationContext';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import type { AppContext } from '@/types/auth';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function pickText(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return null;
}

function joinText(...values: unknown[]): string | null {
  const parts = values.map((value) => asString(value)).filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' ') : null;
}

async function fetchSelfProfileView() {
  try {
    return await apiClient.get<Record<string, unknown>>(endpoints.profile.me, { suppressGlobalErrors: true });
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 403 || error.status === 404)) {
      return null;
    }
    throw error;
  }
}

type EditableDetailFieldProps = {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  hint?: string;
  inputType?: 'text' | 'email' | 'tel';
  inputMode?: 'text' | 'email' | 'tel' | 'numeric';
  onSave?: (value: string) => Promise<void>;
  saving?: boolean;
};

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value || 'Not available'}</p>
    </div>
  );
}

function EditableDetailField({
  label,
  value,
  placeholder,
  hint,
  inputType = 'text',
  inputMode = 'text',
  onSave,
  saving = false,
}: EditableDetailFieldProps) {
  const normalizedValue = asString(value);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(normalizedValue || '');
  const [error, setError] = useState<string | null>(null);

  if (normalizedValue) {
    return <DetailField label={label} value={normalizedValue} />;
  }

  if (!onSave) {
    return <DetailField label={label} value={null} />;
  }

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
          {!isEditing ? <p className="mt-1 text-sm font-medium text-foreground">Not available</p> : null}
          {hint ? <p className="mt-2 text-xs text-muted">{hint}</p> : null}
        </div>
        {!isEditing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(normalizedValue || '');
              setError(null);
              setIsEditing(true);
            }}
            disabled={saving}
          >
            Edit
          </Button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-3 space-y-3">
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            placeholder={placeholder}
            type={inputType}
            inputMode={inputMode}
            disabled={saving}
          />
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              loading={saving}
              loadingText="Saving..."
              disabled={draft.trim().length === 0}
              onClick={async () => {
                const nextValue = draft.trim();
                if (!nextValue) {
                  setError('Enter a value before saving.');
                  return;
                }
                try {
                  await onSave(nextValue);
                  setIsEditing(false);
                } catch (saveError) {
                  setError(saveError instanceof Error ? saveError.message : 'Unable to save this field.');
                }
              }}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setDraft(normalizedValue || '');
                setError(null);
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContextSummaryFields({ context }: { context: AppContext | null }) {
  const scopeKind = getOrganizationScopeKind(context);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <DetailField label="Context Name" value={context?.name} />
      <DetailField label="Context Type" value={context?.type} />
      <DetailField label="Role" value={context?.roleName} />
      <DetailField label="Scope" value={scopeKind || (context?.type === 'platform' ? 'platform' : null)} />
      <DetailField label="Subtitle" value={context?.subtitle} />
    </div>
  );
}

function ContextListItem({ context, isCurrent }: { context: AppContext; isCurrent: boolean }) {
  const scopeKind = getOrganizationScopeKind(context);

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors',
        isCurrent ? 'border-primary/40 bg-primary/5' : 'border-border bg-background',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground">{context.name}</p>
        {isCurrent ? <Badge variant="info">Current</Badge> : null}
        <Badge variant="neutral">{context.type}</Badge>
        {scopeKind ? <Badge variant="neutral">{scopeKind}</Badge> : null}
      </div>
      <div className="mt-2 space-y-1 text-sm text-muted">
        <p>Role: {context.roleName || 'Not assigned'}</p>
        <p>Subtitle: {context.subtitle || 'Not available'}</p>
      </div>
    </div>
  );
}

export function MyProfileSettingsPage() {
  const queryClient = useQueryClient();
  const meQuery = useMe();
  const fallbackUser = useAuthStore((state) => state.user);
  const activeContext = useContextStore((state) => state.activeContext);
  const storedContexts = useContextStore((state) => state.availableContexts);
  const [savingField, setSavingField] = useState<string | null>(null);

  const authUser = meQuery.data?.user ?? fallbackUser;
  const availableContexts = storedContexts.length > 0 ? storedContexts : (meQuery.data?.availableContexts ?? []);

  const profileQuery = useQuery({
    queryKey: ['settings', 'my-profile', 'self', activeContext?.id ?? 'none'],
    enabled: Boolean(authUser?.id),
    retry: false,
    queryFn: fetchSelfProfileView,
  });

  const selfProfile = useMemo(() => asRecord(profileQuery.data), [profileQuery.data]);
  const selfProfileRecord = useMemo(() => asRecord(selfProfile?.profile), [selfProfile]);
  const ninSummaryRecord = useMemo(() => asRecord(selfProfile?.ninSummary), [selfProfile]);
  const addressRecord = useMemo(() => asRecord(selfProfileRecord?.address), [selfProfileRecord]);
  const roles = useMemo(() => Array.from(new Set([...(meQuery.data?.roles ?? []), ...(authUser?.roles ?? [])])), [authUser?.roles, meQuery.data?.roles]);
  const resolvedFullName = useMemo(
    () => pickText(authUser?.fullName, joinText(selfProfileRecord?.firstName, selfProfileRecord?.lastName), selfProfileRecord?.displayName),
    [authUser?.fullName, selfProfileRecord],
  );

  const profileMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => apiClient.patch<{ message?: string }>(
      endpoints.profile.me,
      patch,
      { suppressGlobalErrors: true },
    ),
  });

  const addPhoneMutation = useMutation({
    mutationFn: async (phone: string) => apiClient.post<{ message?: string }>(
      endpoints.auth.contactPhone,
      { phone },
      { suppressGlobalErrors: true },
    ),
  });

  const addEmailMutation = useMutation({
    mutationFn: async (email: string) => apiClient.post<{ message?: string }>(
      endpoints.auth.contactEmail,
      { email },
      { suppressGlobalErrors: true },
    ),
  });

  async function refreshProfileData() {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: meQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['settings', 'my-profile', 'self'] }),
    ]);
    await Promise.allSettled([meQuery.refetch(), profileQuery.refetch()]);
  }

  async function saveProfilePatch(fieldKey: string, patch: Record<string, unknown>, successMessage: string) {
    setSavingField(fieldKey);
    try {
      const response = await profileMutation.mutateAsync(patch);
      await refreshProfileData();
      if (response.message === 'No missing profile fields were updated') {
        toast.message('That field already has a value and remains locked here.');
        return;
      }
      toast.success(successMessage);
    } catch (error) {
      throw error instanceof Error ? error : new Error('Unable to save this field.');
    } finally {
      setSavingField(null);
    }
  }

  async function savePhone(phone: string) {
    setSavingField('phone');
    try {
      await addPhoneMutation.mutateAsync(phone);
      await refreshProfileData();
      toast.success('Phone saved. OTP sent for verification.');
    } catch (error) {
      throw error instanceof Error ? error : new Error('Unable to save phone.');
    } finally {
      setSavingField(null);
    }
  }

  async function saveEmail(email: string) {
    setSavingField('email');
    try {
      await addEmailMutation.mutateAsync(email.toLowerCase());
      await refreshProfileData();
      toast.success('Email saved. OTP sent for verification.');
    } catch (error) {
      throw error instanceof Error ? error : new Error('Unable to save email.');
    } finally {
      setSavingField(null);
    }
  }

  if (!authUser && meQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Profile"
          description="View your identity details, the context you are currently using, and every context available to your account."
          breadcrumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'My Profile' }]}
        />
        <Card className="shadow-subtle">
          <div className="rounded-lg border border-border bg-background p-6 text-sm text-muted">Loading your profile...</div>
        </Card>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Profile"
          description="View your identity details, the context you are currently using, and every context available to your account."
          breadcrumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'My Profile' }]}
        />
        <ErrorState title="Unable to load your profile" description="Retry loading your session details from Settings." onRetry={() => meQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="View your identity details, the context you are currently using, and every context available to your account."
        breadcrumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'My Profile' }]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="shadow-subtle">
          <CardHeader>
            <div>
              <CardTitle>Logged-In User</CardTitle>
              <CardDescription>Your identity record and any richer self-profile details available from the profile service.</CardDescription>
            </div>
          </CardHeader>

          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-semibold text-foreground">{resolvedFullName || 'User'}</h2>
                <Badge variant="info">Signed in</Badge>
                {selfProfileRecord?.profileStatus ? <Badge variant="neutral">{String(selfProfileRecord.profileStatus)}</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-muted">Email: {authUser.email || 'Not available'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {roles.length > 0 ? roles.map((role) => (
                  <Badge key={role} variant="neutral">{role}</Badge>
                )) : <Badge variant="neutral">No roles returned</Badge>}
              </div>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <p>Blank fields on this page can be completed only when they require direct human input. Existing values stay locked to prevent accidental overwrite.</p>
                  <p>
                    Need to correct an existing value? Request Edit. A link will be sent to you so you can submit the profile
                    correction request. It will go through verification before the profile is updated.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => toast.message('Request Edit is coming soon.')}
                >
                  Request Edit
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <EditableDetailField
                label="Display Name"
                value={pickText(selfProfileRecord?.displayName)}
                placeholder="How your profile should be displayed"
                hint="You can fill this only when it is empty."
                saving={savingField === 'displayName'}
                onSave={(value) => saveProfilePatch('displayName', { displayName: value }, 'Display name saved.')}
              />
              <DetailField label="Full Name" value={resolvedFullName} />
              <DetailField label="NIN" value={pickText(authUser.nin, selfProfileRecord?.nin, ninSummaryRecord?.nin)} />
              <EditableDetailField
                label="Phone"
                value={pickText(authUser.phone, selfProfileRecord?.phone)}
                placeholder="08012345678"
                hint="Saving a phone number sends an OTP for verification."
                inputType="tel"
                inputMode="tel"
                saving={savingField === 'phone'}
                onSave={savePhone}
              />
              <EditableDetailField
                label="Email"
                value={pickText(authUser.email, selfProfileRecord?.email)}
                placeholder="name@example.com"
                hint="Saving an email sends an OTP for verification."
                inputType="email"
                inputMode="email"
                saving={savingField === 'email'}
                onSave={saveEmail}
              />
              <DetailField label="Date of Birth" value={pickText(authUser.dob, selfProfileRecord?.dob, ninSummaryRecord?.dob)} />
              <DetailField label="Gender" value={pickText(selfProfileRecord?.gender, ninSummaryRecord?.gender)} />
              <EditableDetailField
                label="Other Name"
                value={pickText(authUser.otherName, selfProfileRecord?.otherName)}
                placeholder="Other name"
                saving={savingField === 'otherName'}
                onSave={(value) => saveProfilePatch('otherName', { otherName: value }, 'Other name saved.')}
              />
              <DetailField label="Nationality" value={pickText(authUser.nationality, selfProfileRecord?.nationality)} />
              <DetailField label="State Of Origin" value={pickText(authUser.stateOfOrigin, selfProfileRecord?.stateOfOrigin)} />
              <DetailField label="Local Government" value={pickText(authUser.localGovernment, selfProfileRecord?.localGovernment)} />
            </div>

            <div>
              <h3 className="mb-3 font-display text-base font-semibold text-foreground">Address</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <EditableDetailField
                  label="Country"
                  value={asString(addressRecord?.country)}
                  placeholder="Country"
                  saving={savingField === 'address.country'}
                  onSave={(value) => saveProfilePatch('address.country', { address: { country: value } }, 'Address country saved.')}
                />
                <EditableDetailField
                  label="State"
                  value={asString(addressRecord?.state)}
                  placeholder="State"
                  saving={savingField === 'address.state'}
                  onSave={(value) => saveProfilePatch('address.state', { address: { state: value } }, 'Address state saved.')}
                />
                <EditableDetailField
                  label="LGA"
                  value={asString(addressRecord?.lga)}
                  placeholder="Local government area"
                  saving={savingField === 'address.lga'}
                  onSave={(value) => saveProfilePatch('address.lga', { address: { lga: value } }, 'Address LGA saved.')}
                />
                <EditableDetailField
                  label="City"
                  value={asString(addressRecord?.city)}
                  placeholder="City"
                  saving={savingField === 'address.city'}
                  onSave={(value) => saveProfilePatch('address.city', { address: { city: value } }, 'Address city saved.')}
                />
                <EditableDetailField
                  label="Address Line 1"
                  value={asString(addressRecord?.line1)}
                  placeholder="Street address"
                  saving={savingField === 'address.line1'}
                  onSave={(value) => saveProfilePatch('address.line1', { address: { line1: value } }, 'Address line 1 saved.')}
                />
                <EditableDetailField
                  label="Address Line 2"
                  value={asString(addressRecord?.line2)}
                  placeholder="Apartment, suite, or area"
                  saving={savingField === 'address.line2'}
                  onSave={(value) => saveProfilePatch('address.line2', { address: { line2: value } }, 'Address line 2 saved.')}
                />
                <EditableDetailField
                  label="Postal Code"
                  value={asString(addressRecord?.postalCode)}
                  placeholder="Postal code"
                  inputMode="numeric"
                  saving={savingField === 'address.postalCode'}
                  onSave={(value) => saveProfilePatch('address.postalCode', { address: { postalCode: value } }, 'Postal code saved.')}
                />
              </div>
            </div>

            {profileQuery.isError ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                Rich self-profile details could not be loaded from `/profile/me` in the current context. The page is showing your identity record and contexts from `/auth/me`.
              </div>
            ) : null}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="shadow-subtle">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div>
                  <CardTitle>Current Context</CardTitle>
                  <CardDescription>The context you are operating in right now.</CardDescription>
                </div>
                {activeContext ? <Badge variant="info">Current</Badge> : null}
              </div>
            </CardHeader>
            {activeContext ? (
              <ContextSummaryFields context={activeContext} />
            ) : (
              <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted">
                No active context is currently selected.
              </div>
            )}
          </Card>

          <Card className="shadow-subtle">
            <CardHeader>
              <div>
                <CardTitle>Accessible Contexts</CardTitle>
                <CardDescription>Every context currently available to this signed-in account.</CardDescription>
              </div>
              <Badge variant="neutral">{availableContexts.length}</Badge>
            </CardHeader>
            {availableContexts.length > 0 ? (
              <div className="space-y-3">
                {availableContexts.map((context) => (
                  <ContextListItem
                    key={context.id}
                    context={context}
                    isCurrent={context.id === activeContext?.id}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted">
                No additional contexts were returned for this account.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
