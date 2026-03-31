import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Lock, Save, Search, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext } from '@/lib/organizationContext';
import {
  searchManagedUserProfiles,
  useManagedUserProfile,
  useUpdateManagedUserProfile,
  type ManagedUserProfile,
  type ManagedUserProfileInput,
  type ManagedUserProfilePatch,
  type ManagedUserSearchResult,
} from '@/api/hooks/useManagedUserProfiles';

const notificationChannelOptions = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
] as const;

const lockedInputClassName = 'cursor-not-allowed bg-muted/30 text-muted opacity-100';

function normalizeText(value: string | null | undefined) {
  return String(value || '').trim();
}

function normalizeStringArray(values: string[] | null | undefined) {
  return Array.isArray(values) ? values.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function hasTextValue(value: string | null | undefined) {
  return normalizeText(value).length > 0;
}

function hasArrayValue(values: string[] | null | undefined) {
  return normalizeStringArray(values).length > 0;
}

function mapProfileToForm(profile: ManagedUserProfile): ManagedUserProfileInput {
  return {
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
  };
}

function hasPatchValues(patch: ManagedUserProfilePatch) {
  return Object.values(patch).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function buildManagedProfilePatch(profile: ManagedUserProfile, form: ManagedUserProfileInput): ManagedUserProfilePatch {
  const patch: ManagedUserProfilePatch = {};

  if (!hasTextValue(profile.displayName) && hasTextValue(form.displayName)) patch.displayName = normalizeText(form.displayName);
  if (!hasTextValue(profile.firstName) && hasTextValue(form.firstName)) patch.firstName = normalizeText(form.firstName);
  if (!hasTextValue(profile.lastName) && hasTextValue(form.lastName)) patch.lastName = normalizeText(form.lastName);
  if (!hasTextValue(profile.otherName) && hasTextValue(form.otherName)) patch.otherName = normalizeText(form.otherName);
  if (!hasTextValue(profile.dob) && hasTextValue(form.dob)) patch.dob = normalizeText(form.dob);
  if (!hasTextValue(profile.gender) && hasTextValue(form.gender)) patch.gender = normalizeText(form.gender);
  if (!hasTextValue(profile.phone) && hasTextValue(form.phone)) patch.phone = normalizeText(form.phone);
  if (!hasTextValue(profile.email) && hasTextValue(form.email)) patch.email = normalizeText(form.email).toLowerCase();

  const professionTypes = normalizeStringArray(form.professionTypes);
  if (!hasArrayValue(profile.professionTypes) && professionTypes.length > 0) {
    patch.professionTypes = professionTypes;
  }

  const addressPatch: NonNullable<ManagedUserProfilePatch['address']> = {};
  if (!hasTextValue(profile.address?.country) && hasTextValue(form.address.country)) addressPatch.country = normalizeText(form.address.country);
  if (!hasTextValue(profile.address?.state) && hasTextValue(form.address.state)) addressPatch.state = normalizeText(form.address.state);
  if (!hasTextValue(profile.address?.lga) && hasTextValue(form.address.lga)) addressPatch.lga = normalizeText(form.address.lga);
  if (!hasTextValue(profile.address?.city) && hasTextValue(form.address.city)) addressPatch.city = normalizeText(form.address.city);
  if (!hasTextValue(profile.address?.line1) && hasTextValue(form.address.line1)) addressPatch.line1 = normalizeText(form.address.line1);
  if (!hasTextValue(profile.address?.line2) && hasTextValue(form.address.line2)) addressPatch.line2 = normalizeText(form.address.line2);
  if (!hasTextValue(profile.address?.postalCode) && hasTextValue(form.address.postalCode)) addressPatch.postalCode = normalizeText(form.address.postalCode);
  if (Object.keys(addressPatch).length > 0) {
    patch.address = addressPatch;
  }

  const preferencesPatch: NonNullable<ManagedUserProfilePatch['preferences']> = {};
  const notificationChannels = normalizeStringArray(form.preferences.notificationChannels);
  if (!hasArrayValue(profile.preferences?.notificationChannels) && notificationChannels.length > 0) {
    preferencesPatch.notificationChannels = notificationChannels;
  }
  if (!hasTextValue(profile.preferences?.language) && hasTextValue(form.preferences.language)) {
    preferencesPatch.language = normalizeText(form.preferences.language);
  }
  if (Object.keys(preferencesPatch).length > 0) {
    patch.preferences = preferencesPatch;
  }

  return patch;
}

function fieldHint(editable: boolean, editableHint = 'Empty fields can be completed here.') {
  return editable ? editableHint : 'Already populated and locked here.';
}

function inputClassName(editable: boolean) {
  return editable ? undefined : lockedInputClassName;
}

function ManagedProfileEditor({
  profile,
  onSave,
  isSaving,
}: {
  profile: ManagedUserProfile;
  onSave: (values: ManagedUserProfilePatch) => Promise<void>;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<ManagedUserProfileInput>(() => mapProfileToForm(profile));
  const profilePatch = useMemo(() => buildManagedProfilePatch(profile, form), [profile, form]);
  const hasPendingUpdates = hasPatchValues(profilePatch);

  const editable = useMemo(() => ({
    displayName: !hasTextValue(profile.displayName),
    professionTypes: !hasArrayValue(profile.professionTypes),
    firstName: !hasTextValue(profile.firstName),
    lastName: !hasTextValue(profile.lastName),
    otherName: !hasTextValue(profile.otherName),
    gender: !hasTextValue(profile.gender),
    dob: !hasTextValue(profile.dob),
    phone: !hasTextValue(profile.phone),
    email: !hasTextValue(profile.email),
    country: !hasTextValue(profile.address?.country),
    state: !hasTextValue(profile.address?.state),
    lga: !hasTextValue(profile.address?.lga),
    city: !hasTextValue(profile.address?.city),
    line1: !hasTextValue(profile.address?.line1),
    line2: !hasTextValue(profile.address?.line2),
    postalCode: !hasTextValue(profile.address?.postalCode),
    language: !hasTextValue(profile.preferences?.language),
    notificationChannels: !hasArrayValue(profile.preferences?.notificationChannels),
  }), [profile]);

  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!hasPendingUpdates) {
          toast.info('No missing field has been filled yet');
          return;
        }
        await onSave(profilePatch);
        toast.success('Missing profile details updated');
      }}
    >
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted">
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 text-primary" />
          <p>Populate only the empty profile fields below. Locked fields already have values and are protected from overwrite here.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Display Name" hint={fieldHint(editable.displayName)}>
          <Input
            value={form.displayName}
            onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
            disabled={!editable.displayName}
            className={inputClassName(editable.displayName)}
          />
        </FormField>
        <FormField label="Profession Types" hint={fieldHint(editable.professionTypes, 'Comma-separated values')}>
          <Input
            value={form.professionTypes.join(', ')}
            onChange={(event) => setForm((current) => ({
              ...current,
              professionTypes: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
            }))}
            placeholder="doctor, nurse, admin"
            disabled={!editable.professionTypes}
            className={inputClassName(editable.professionTypes)}
          />
        </FormField>
        <FormField label="First Name" hint={fieldHint(editable.firstName)}>
          <Input
            value={form.firstName}
            onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
            disabled={!editable.firstName}
            className={inputClassName(editable.firstName)}
          />
        </FormField>
        <FormField label="Last Name" hint={fieldHint(editable.lastName)}>
          <Input
            value={form.lastName}
            onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
            disabled={!editable.lastName}
            className={inputClassName(editable.lastName)}
          />
        </FormField>
        <FormField label="Other Name" hint={fieldHint(editable.otherName)}>
          <Input
            value={form.otherName}
            onChange={(event) => setForm((current) => ({ ...current, otherName: event.target.value }))}
            disabled={!editable.otherName}
            className={inputClassName(editable.otherName)}
          />
        </FormField>
        <FormField label="Gender" hint={fieldHint(editable.gender)}>
          <Input
            value={form.gender}
            onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}
            disabled={!editable.gender}
            className={inputClassName(editable.gender)}
          />
        </FormField>
        <FormField label="Date of Birth" hint={fieldHint(editable.dob, 'Use YYYY-MM-DD when possible.')}>
          <Input
            value={form.dob}
            onChange={(event) => setForm((current) => ({ ...current, dob: event.target.value }))}
            placeholder="YYYY-MM-DD"
            disabled={!editable.dob}
            className={inputClassName(editable.dob)}
          />
        </FormField>
        <FormField label="Phone Number" hint={fieldHint(editable.phone)}>
          <Input
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            disabled={!editable.phone}
            className={inputClassName(editable.phone)}
          />
        </FormField>
        <FormField label="Email Address" hint={fieldHint(editable.email)} className="md:col-span-2">
          <Input
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            disabled={!editable.email}
            className={inputClassName(editable.email)}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Country" hint={fieldHint(editable.country)}>
          <Input
            value={form.address.country}
            onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, country: event.target.value } }))}
            disabled={!editable.country}
            className={inputClassName(editable.country)}
          />
        </FormField>
        <FormField label="State" hint={fieldHint(editable.state)}>
          <Input
            value={form.address.state}
            onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, state: event.target.value } }))}
            disabled={!editable.state}
            className={inputClassName(editable.state)}
          />
        </FormField>
        <FormField label="LGA" hint={fieldHint(editable.lga)}>
          <Input
            value={form.address.lga}
            onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, lga: event.target.value } }))}
            disabled={!editable.lga}
            className={inputClassName(editable.lga)}
          />
        </FormField>
        <FormField label="City" hint={fieldHint(editable.city)}>
          <Input
            value={form.address.city}
            onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, city: event.target.value } }))}
            disabled={!editable.city}
            className={inputClassName(editable.city)}
          />
        </FormField>
        <FormField label="Address Line 1" hint={fieldHint(editable.line1)} className="md:col-span-2">
          <Input
            value={form.address.line1}
            onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, line1: event.target.value } }))}
            disabled={!editable.line1}
            className={inputClassName(editable.line1)}
          />
        </FormField>
        <FormField label="Address Line 2" hint={fieldHint(editable.line2)} className="md:col-span-2">
          <Input
            value={form.address.line2}
            onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, line2: event.target.value } }))}
            disabled={!editable.line2}
            className={inputClassName(editable.line2)}
          />
        </FormField>
        <FormField label="Postal Code" hint={fieldHint(editable.postalCode)}>
          <Input
            value={form.address.postalCode}
            onChange={(event) => setForm((current) => ({ ...current, address: { ...current.address, postalCode: event.target.value } }))}
            disabled={!editable.postalCode}
            className={inputClassName(editable.postalCode)}
          />
        </FormField>
        <FormField label="Language" hint={fieldHint(editable.language)}>
          <Input
            value={form.preferences.language}
            onChange={(event) => setForm((current) => ({ ...current, preferences: { ...current.preferences, language: event.target.value } }))}
            disabled={!editable.language}
            className={inputClassName(editable.language)}
          />
        </FormField>
      </div>

      <FormField label="Notification Channels" hint={fieldHint(editable.notificationChannels)}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {notificationChannelOptions.map((option) => {
            const checked = form.preferences.notificationChannels.includes(option.value);
            return (
              <label
                key={option.value}
                className={`flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm ${
                  editable.notificationChannels ? 'text-foreground' : 'cursor-not-allowed bg-muted/30 text-muted'
                }`}
              >
                <span>{option.label}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!editable.notificationChannels}
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
        <Button type="submit" loading={isSaving} loadingText="Saving details..." disabled={!hasPendingUpdates}>
          <Save className="h-4 w-4" />
          Save Missing Details
        </Button>
      </div>
    </form>
  );
}

export function UserSettingsPage() {
  const activeContext = useContextStore((state) => state.activeContext);
  const organizationId = getOrganizationIdFromContext(activeContext);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userLookup, setUserLookup] = useState<Record<string, ManagedUserSearchResult>>({});
  const profileQuery = useManagedUserProfile(selectedUserId ?? undefined, organizationId);
  const updateProfile = useUpdateManagedUserProfile();

  const selectedUser = useMemo(() => (selectedUserId ? userLookup[selectedUserId] ?? null : null), [selectedUserId, userLookup]);

  const loadOptions = useCallback(async (search: string) => {
    const results = await searchManagedUserProfiles(search, organizationId);
    if (results.length > 0) {
      setUserLookup((current) => {
        const next = { ...current };
        results.forEach((item) => {
          next[item.userId] = item;
        });
        return next;
      });
    }
    return results.map((item) => ({
      value: item.userId,
      label: item.displayName,
      description: [item.nin, item.phone, item.email, item.profileStatus].filter(Boolean).join(' | '),
    }));
  }, [organizationId]);

  const saveProfile = useCallback(async (values: ManagedUserProfilePatch) => {
    if (!selectedUserId) return;
    await updateProfile.mutateAsync({
      userId: selectedUserId,
      organizationId,
      values,
    });
  }, [organizationId, selectedUserId, updateProfile]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile Management"
        description="Search for a person and complete only the profile details that are still blank."
        breadcrumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Profile Management' }]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="shadow-subtle">
          <CardHeader>
            <div>
              <CardTitle>Find Person</CardTitle>
              <CardDescription>
                Search by NIN, phone number, email address, or name.
                {organizationId ? ' Results are limited to the active organization.' : ' Results are loaded from the managed profile index.'}
              </CardDescription>
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
                  <p>Status: {selectedUser.profileStatus || 'Unknown'}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted">
                Select a person to load the managed profile.
              </div>
            )}
          </div>
        </Card>

        <Card className="shadow-subtle">
          <CardHeader>
            <div>
              <CardTitle>Complete Missing Profile Details</CardTitle>
              <CardDescription>Existing values stay locked on this screen. Only missing fields can be completed and saved.</CardDescription>
            </div>
          </CardHeader>

          {!selectedUserId ? (
            <div className="rounded-lg border border-border bg-background p-6 text-sm text-muted">
              No person selected yet.
            </div>
          ) : profileQuery.isError ? (
            <ErrorState title="Unable to load profile" description="Retry loading the selected person's profile." onRetry={() => profileQuery.refetch()} />
          ) : profileQuery.isLoading || !profileQuery.data ? (
            <div className="rounded-lg border border-border bg-background p-6 text-sm text-muted">
              Loading selected profile...
            </div>
          ) : (
            <ManagedProfileEditor
              key={`${selectedUserId}:${profileQuery.dataUpdatedAt}`}
              profile={profileQuery.data}
              onSave={saveProfile}
              isSaving={updateProfile.isPending}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
