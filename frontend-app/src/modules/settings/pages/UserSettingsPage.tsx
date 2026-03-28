import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Save, Search, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import { searchAccessUsers, type UserSearchResult } from '@/api/hooks/useAccessControl';
import {
  useManagedUserProfile,
  useUpdateManagedUserProfile,
  type ManagedUserProfileInput,
} from '@/api/hooks/useManagedUserProfiles';

const notificationChannelOptions = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
] as const;

const emptyForm: ManagedUserProfileInput = {
  displayName: '',
  firstName: '',
  lastName: '',
  otherName: '',
  dob: '',
  gender: '',
  phone: '',
  email: '',
  professionTypes: [],
  address: {
    country: '',
    state: '',
    lga: '',
    city: '',
    line1: '',
    line2: '',
    postalCode: '',
  },
  preferences: {
    notificationChannels: [],
    language: '',
  },
};

export function UserSettingsPage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const organizationId = getOrganizationIdFromContext(activeContext);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userLookup, setUserLookup] = useState<Record<string, UserSearchResult>>({});
  const [form, setForm] = useState<ManagedUserProfileInput>(emptyForm);
  const profileQuery = useManagedUserProfile(selectedUserId ?? undefined, organizationId);
  const updateProfile = useUpdateManagedUserProfile();

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    setForm({
      displayName: profile.displayName || '',
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      otherName: profile.otherName || '',
      dob: profile.dob || '',
      gender: profile.gender || '',
      phone: profile.phone || '',
      email: profile.email || '',
      professionTypes: profile.professionTypes || [],
      address: {
        country: profile.address?.country || '',
        state: profile.address?.state || '',
        lga: profile.address?.lga || '',
        city: profile.address?.city || '',
        line1: profile.address?.line1 || '',
        line2: profile.address?.line2 || '',
        postalCode: profile.address?.postalCode || '',
      },
      preferences: {
        notificationChannels: profile.preferences?.notificationChannels || [],
        language: profile.preferences?.language || '',
      },
    });
  }, [profileQuery.data]);

  const selectedUser = useMemo(() => (selectedUserId ? userLookup[selectedUserId] ?? null : null), [selectedUserId, userLookup]);

  const loadOptions = useCallback(async (search: string) => {
    void organizationId;
    const results = await searchAccessUsers(search);
    if (results.length > 0) {
      setUserLookup((current) => {
        const next = { ...current };
        results.forEach((item) => {
          next[item.id] = item;
        });
        return next;
      });
    }
    return results.map((item) => ({
      value: item.id,
      label: item.displayName,
      description: [item.nin, item.phone, item.email, item.bvn ? `BVN:${item.bvn}` : undefined].filter(Boolean).join(' | '),
    }));
  }, [organizationId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Settings"
        description="Search for a user, load the profile, and update the person's record from app settings."
        breadcrumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'User Settings' }]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="shadow-subtle">
          <CardHeader>
            <div>
              <CardTitle>Find User Profile</CardTitle>
              <CardDescription>Search by NIN, phone number, email address, or name. Nothing is preloaded; results only appear when you search.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3 text-sm text-muted">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Search className="h-4 w-4" />
                <span className="font-medium">Search People</span>
              </div>
              <SmartSelect
                value={selectedUserId}
                onChange={setSelectedUserId}
                placeholder="Type phone, email, NIN, or name"
                emptyLabel="No matching person found"
                debounceMs={450}
                loadOptions={loadOptions}
              />
            </div>

            {selectedUser ? (
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="mb-2 flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">{selectedUser.displayName}</p>
                </div>
                <div className="space-y-1 text-sm text-muted">
                  <p>NIN: {selectedUser.nin || 'Not available'}</p>
                  <p>Phone: {selectedUser.phone || 'Not available'}</p>
                  <p>Email: {selectedUser.email || 'Not available'}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted">
                Select a person to load their profile.
              </div>
            )}
          </div>
        </Card>

        <Card className="shadow-subtle">
          <CardHeader>
            <div>
              <CardTitle>Profile Editor</CardTitle>
              <CardDescription>Update the selected person's profile record and contact metadata for organization use.</CardDescription>
            </div>
          </CardHeader>

          {!selectedUserId ? (
            <div className="rounded-lg border border-border bg-background p-6 text-sm text-muted">
              No person selected yet.
            </div>
          ) : profileQuery.isError ? (
            <ErrorState title="Unable to load profile" description="Retry loading the selected person's profile." onRetry={() => profileQuery.refetch()} />
          ) : profileQuery.isLoading ? (
            <div className="rounded-lg border border-border bg-background p-6 text-sm text-muted">
              Loading selected profile...
            </div>
          ) : (
            <form
              className="space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedUserId) return;
                await updateProfile.mutateAsync({
                  userId: selectedUserId,
                  organizationId,
                  values: form,
                });
                toast.success('User profile updated');
              }}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Display Name">
                  <Input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} />
                </FormField>
                <FormField label="Profession Types" hint="Comma-separated values">
                  <Input
                    value={form.professionTypes.join(', ')}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      professionTypes: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                    }))}
                    placeholder="doctor, nurse, admin"
                  />
                </FormField>
                <FormField label="First Name">
                  <Input value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} />
                </FormField>
                <FormField label="Last Name">
                  <Input value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} />
                </FormField>
                <FormField label="Other Name">
                  <Input value={form.otherName} onChange={(event) => setForm((current) => ({ ...current, otherName: event.target.value }))} />
                </FormField>
                <FormField label="Gender">
                  <Input value={form.gender} onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))} />
                </FormField>
                <FormField label="Date of Birth">
                  <Input value={form.dob} onChange={(event) => setForm((current) => ({ ...current, dob: event.target.value }))} placeholder="YYYY-MM-DD or local format" />
                </FormField>
                <FormField label="Phone Number">
                  <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
                </FormField>
                <FormField label="Email Address" className="md:col-span-2">
                  <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                </FormField>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Country">
                  <Input value={form.address.country} onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, country: event.target.value } }))} />
                </FormField>
                <FormField label="State">
                  <Input value={form.address.state} onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, state: event.target.value } }))} />
                </FormField>
                <FormField label="LGA">
                  <Input value={form.address.lga} onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, lga: event.target.value } }))} />
                </FormField>
                <FormField label="City">
                  <Input value={form.address.city} onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, city: event.target.value } }))} />
                </FormField>
                <FormField label="Address Line 1" className="md:col-span-2">
                  <Input value={form.address.line1} onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, line1: event.target.value } }))} />
                </FormField>
                <FormField label="Address Line 2" className="md:col-span-2">
                  <Input value={form.address.line2} onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, line2: event.target.value } }))} />
                </FormField>
                <FormField label="Postal Code">
                  <Input value={form.address.postalCode} onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, postalCode: event.target.value } }))} />
                </FormField>
                <FormField label="Language">
                  <Input value={form.preferences.language} onChange={(event) => setForm((current) => ({ ...current, preferences: { ...current.preferences, language: event.target.value } }))} />
                </FormField>
              </div>

              <FormField label="Notification Channels">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {notificationChannelOptions.map((option) => {
                    const checked = form.preferences.notificationChannels.includes(option.value);
                    return (
                      <label key={option.value} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm text-foreground">
                        <span>{option.label}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setForm((current) => {
                              const next = new Set(current.preferences.notificationChannels);
                              if (event.target.checked) next.add(option.value);
                              else next.delete(option.value);
                              return {
                                ...current,
                                preferences: {
                                  ...current.preferences,
                                  notificationChannels: Array.from(next),
                                },
                              };
                            });
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </FormField>

              <div className="flex justify-end">
                <Button type="submit" loading={updateProfile.isPending} loadingText="Saving profile...">
                  <Save className="h-4 w-4" />
                  Save Profile
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
