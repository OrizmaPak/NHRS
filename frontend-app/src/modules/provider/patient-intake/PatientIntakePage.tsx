import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';
import { useContextStore } from '@/stores/contextStore';
import { getOrganizationIdFromContext, getOrganizationScopeKind, getOrganizationWorkspaceBasePath } from '@/lib/organizationContext';
import { useScopedInstitutions, useInstitutionById, useInstitutionBranches, useBranchById } from '@/api/hooks/useInstitutions';
import { usePatientProfile } from '@/api/hooks/usePatientProfile';
import { useCarePatients, useRegisterCarePatient } from '@/api/hooks/useCarePatients';

function scopeTitle(scopeKind: 'organization' | 'institution' | 'branch' | null): string {
  if (scopeKind === 'branch') return 'Patient Intake';
  if (scopeKind === 'institution') return 'Patient Intake';
  return 'Patient Intake';
}

function readPatientString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function formatPatientDob(value: string | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = /^\d{8}$/.test(raw)
    ? new Date(Number(raw.slice(4, 8)), Number(raw.slice(2, 4)) - 1, Number(raw.slice(0, 2)))
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPatientAddress(source: Record<string, unknown>): string | null {
  const directAddress = readPatientString(source, 'addressText', 'residentialAddress');
  if (directAddress) return directAddress;

  const address = source.address && typeof source.address === 'object'
    ? source.address as Record<string, unknown>
    : null;
  if (!address) return null;

  const parts = [
    readPatientString(address, 'line1', 'addressLine1', 'street'),
    readPatientString(address, 'line2', 'addressLine2'),
    readPatientString(address, 'city', 'town'),
    readPatientString(address, 'lga', 'localGovernment'),
    readPatientString(address, 'state', 'stateOfOrigin'),
    readPatientString(address, 'country'),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

function getPatientPhotoUrl(source: Record<string, unknown>): string | null {
  const metadata = source.metadata && typeof source.metadata === 'object'
    ? source.metadata as Record<string, unknown>
    : null;
  return readPatientString(
    source,
    'photoUrl',
    'profilePhotoUrl',
    'profilePictureUrl',
    'avatarUrl',
    'imageUrl',
    'passportPhotoUrl',
  ) || (metadata
    ? readPatientString(
      metadata,
      'photoUrl',
      'profilePhotoUrl',
      'profilePictureUrl',
      'avatarUrl',
      'imageUrl',
      'passportPhotoUrl',
    )
    : null);
}

export function PatientIntakePage() {
  const location = useLocation();
  const activeContext = useContextStore((state) => state.activeContext);
  const organizationId = getOrganizationIdFromContext(activeContext);
  const scopeKind = getOrganizationScopeKind(activeContext);
  const basePath = getOrganizationWorkspaceBasePath(location.pathname, activeContext);
  const workspaceLabel = basePath === '/app/care' ? 'Patient Care' : 'Provider';
  const isScopedCare = scopeKind === 'institution' || scopeKind === 'branch';
  const isBranchScopedCare = scopeKind === 'branch';

  const [ninInput, setNinInput] = useState('');
  const [lookupNin, setLookupNin] = useState('');
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(activeContext?.institutionId || null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(activeContext?.branchId || null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const institutionsQuery = useScopedInstitutions({
    page: 1,
    limit: 200,
    orgId: organizationId,
  });
  const currentInstitutionQuery = useInstitutionById(selectedInstitutionId || undefined);
  const institutionBranchesQuery = useInstitutionBranches(organizationId, selectedInstitutionId || undefined);
  const currentBranchQuery = useBranchById(activeContext?.branchId || undefined);

  const patientLookupQuery = usePatientProfile(lookupNin, {
    viewMode: activeContext?.type === 'organization' ? 'patient-care' : 'default',
    organizationId,
  });
  const existingPatientQuery = useCarePatients(
    {
      page: 1,
      limit: 1,
      organizationId,
      nin: lookupNin || undefined,
    },
    Boolean(lookupNin && organizationId),
  );
  const registerPatient = useRegisterCarePatient();

  const institutionOptions = useMemo(
    () =>
      (institutionsQuery.data?.rows ?? []).map((row) => ({
        value: row.institutionId,
        label: `${row.name}${row.code ? ` (${row.code})` : ''}`,
      })),
    [institutionsQuery.data?.rows],
  );

  const selectedInstitutionLabel = currentInstitutionQuery.data?.institution?.name
    || institutionOptions.find((entry) => entry.value === selectedInstitutionId)?.label
    || '';
  const branchOptions = useMemo(
    () =>
      (institutionBranchesQuery.data ?? []).map((row) => ({
        value: row.branchId,
        label: `${row.name}${row.code ? ` (${row.code})` : ''}`,
      })),
    [institutionBranchesQuery.data],
  );
  const branchSelectOptions = useMemo(
    () => [
      {
        value: '__institution__',
        label: 'Institution-wide only',
        description: 'Do not tie this patient intake to a specific branch.',
      },
      ...branchOptions,
    ],
    [branchOptions],
  );
  const effectiveSelectedBranchId = isBranchScopedCare
    ? (activeContext?.branchId || null)
    : (selectedBranchId && branchOptions.some((entry) => entry.value === selectedBranchId) ? selectedBranchId : null);
  const selectedBranchLabel = currentBranchQuery.data?.branch?.name
    || branchOptions.find((entry) => entry.value === effectiveSelectedBranchId)?.label
    || '';
  const shouldShowBranchField = Boolean(selectedInstitutionId && (isBranchScopedCare || institutionBranchesQuery.isLoading || branchOptions.length > 0));
  const patientRaw = useMemo(() => patientLookupQuery.data?.raw ?? {}, [patientLookupQuery.data?.raw]);
  const patientPhotoUrl = getPatientPhotoUrl(patientRaw);
  const patientDob = formatPatientDob(readPatientString(patientRaw, 'dob'));
  const patientAddress = formatPatientAddress(patientRaw);
  const patientDetails = [
    { label: 'Full Name', value: patientLookupQuery.data?.name ?? null },
    { label: 'NIN', value: patientLookupQuery.data?.nin ?? null },
    { label: 'First Name', value: readPatientString(patientRaw, 'firstName') },
    { label: 'Other Name', value: readPatientString(patientRaw, 'otherName', 'middleName') },
    { label: 'Last Name', value: readPatientString(patientRaw, 'lastName', 'surname') },
    { label: 'Gender', value: patientLookupQuery.data?.gender ?? null },
    { label: 'Date of Birth', value: patientDob },
    { label: 'Age', value: patientLookupQuery.data?.age !== null && patientLookupQuery.data?.age !== undefined ? String(patientLookupQuery.data.age) : null },
    { label: 'Phone', value: readPatientString(patientRaw, 'phone', 'phoneNumber') },
    { label: 'Email', value: readPatientString(patientRaw, 'email') },
    { label: 'Nationality', value: readPatientString(patientRaw, 'nationality') },
    { label: 'State of Origin', value: readPatientString(patientRaw, 'stateOfOrigin', 'state') },
    { label: 'Local Government', value: readPatientString(patientRaw, 'localGovernment', 'lga') },
    { label: 'Residential Address', value: patientAddress },
  ].filter((entry) => entry.value);

  const existingPatient = existingPatientQuery.data?.rows?.[0] ?? null;
  const alreadyRegistered = Boolean(existingPatient);
  const institutionAlreadyAssigned = Boolean(
    selectedInstitutionId
      && existingPatient
      && (
        existingPatient.institutionId === selectedInstitutionId
        || existingPatient.institutionIds?.includes(selectedInstitutionId)
      ),
  );
  const branchAlreadyAssigned = Boolean(
    effectiveSelectedBranchId
      && existingPatient
      && (
        existingPatient.branchId === effectiveSelectedBranchId
        || existingPatient.branchIds?.includes(effectiveSelectedBranchId)
      ),
  );

  const onLookup = () => {
    const normalizedNin = ninInput.trim();
    if (!/^\d{11}$/.test(normalizedNin)) {
      setValidationMessage('Enter a valid 11-digit NIN before searching.');
      return;
    }
    setValidationMessage(null);
    registerPatient.reset();
    setLookupNin(normalizedNin);
  };

  const onRegister = async () => {
    if (!organizationId || !lookupNin) return;
    await registerPatient.mutateAsync({
      nin: lookupNin,
      organizationId,
      institutionId: selectedInstitutionId || undefined,
      branchId: effectiveSelectedBranchId || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={scopeTitle(scopeKind)}
        description="Look up a patient by NIN, confirm the details, and add the patient into the organization-wide care register. Once added, the patient becomes searchable anywhere inside this organization."
        breadcrumbs={[{ label: workspaceLabel }, { label: 'Patient Intake' }]}
        actions={
          <Button asChild variant="outline">
            <Link to={`${basePath}/patients`}>Open Patient Search</Link>
          </Button>
        }
      />

      <Card className="border-border/70 bg-gradient-to-br from-surface via-surface to-surface/80">
        <CardHeader>
          <CardTitle>Register Patient Into Care Search</CardTitle>
          <CardDescription>
            Search by NIN first. Once the patient is added to the organization register, the patient becomes visible in Patient Search across the organization. Institution and branch are optional attribution details for where the patient first came in.
          </CardDescription>
          {scopeKind === 'branch' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              This branch uses the organization patient register. Add the patient once here, and the patient becomes searchable anywhere in the organization while still being tagged to the current branch.
            </div>
          ) : null}
        </CardHeader>
      </Card>

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Organization">
            <Input value={activeContext?.name || organizationId || ''} readOnly />
          </FormField>
          <FormField
            label="Institution"
            hint={isScopedCare ? 'This is fixed from the current active context.' : 'Optional. Choose the institution where this patient first came in, if you want that attribution saved.'}
          >
            {isScopedCare ? (
              <Input value={selectedInstitutionLabel || activeContext?.subtitle || ''} readOnly />
            ) : (
              <SmartSelect
                value={selectedInstitutionId}
                onChange={(value) => {
                  registerPatient.reset();
                  setSelectedInstitutionId(value);
                  setSelectedBranchId(null);
                }}
                placeholder="Select institution"
                loadOptions={async (input) =>
                  institutionOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                }
              />
            )}
          </FormField>
          {shouldShowBranchField ? (
            <FormField
              label="Branch"
              hint={
                isBranchScopedCare
                  ? 'This is fixed from the current active branch context.'
                  : 'Optional. Choose a branch if the patient should also be attached to a specific branch under this institution.'
              }
            >
              {isBranchScopedCare ? (
                <Input value={selectedBranchLabel || activeContext?.subtitle || ''} readOnly />
              ) : branchOptions.length > 0 ? (
                <SmartSelect
                  value={effectiveSelectedBranchId ?? '__institution__'}
                  onChange={(value) => {
                    registerPatient.reset();
                    setSelectedBranchId(value === '__institution__' ? null : value);
                  }}
                  placeholder="Select branch"
                  selectedLabel={effectiveSelectedBranchId ? selectedBranchLabel : 'Institution-wide only'}
                  loadOptions={async (input) =>
                    branchSelectOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
                  }
                />
              ) : (
                <Input value="No branches under this institution yet" readOnly />
              )}
            </FormField>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr),auto]">
          <FormField label="Patient NIN" hint="Use the patient’s 11-digit NIN to fetch the record details before adding.">
            <Input
              value={ninInput}
              inputMode="numeric"
              maxLength={11}
              placeholder="Enter 11-digit NIN"
              onChange={(event) => setNinInput(event.target.value.replace(/\D/g, '').slice(0, 11))}
            />
          </FormField>
          <div className="flex items-end">
            <Button onClick={onLookup} disabled={!organizationId}>
              Find Patient
            </Button>
          </div>
        </div>

        {validationMessage ? <p className="mt-3 text-sm text-danger">{validationMessage}</p> : null}
      </Card>

      {lookupNin ? (
        patientLookupQuery.isLoading ? (
          <LoadingSkeleton className="h-40 w-full" />
        ) : patientLookupQuery.isError ? (
          <ErrorState
            title="Unable to load patient details"
            description="Retry the NIN lookup. If the issue persists, confirm the NIN and try again."
            onRetry={() => patientLookupQuery.refetch()}
          />
        ) : patientLookupQuery.data ? (
          <Card className="p-5">
            <div className="space-y-4">
              <div className="grid gap-5 lg:grid-cols-[220px,minmax(0,1fr)]">
                <div className="rounded-2xl border border-border bg-gradient-to-br from-surface via-surface to-surface/70 p-4">
                  <div className="mx-auto flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/40">
                    {patientPhotoUrl ? (
                      <img src={patientPhotoUrl} alt={patientLookupQuery.data.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-display text-5xl font-semibold text-muted">
                        {patientLookupQuery.data.name.charAt(0).toUpperCase() || 'P'}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 space-y-2 text-center">
                    <h2 className="font-display text-xl font-semibold text-foreground">{patientLookupQuery.data.name}</h2>
                    <p className="text-sm text-muted">NIN: {patientLookupQuery.data.nin}</p>
                    <div className="flex flex-wrap justify-center gap-2 text-xs">
                      <span className="rounded-md border border-border px-2 py-1">Age: {patientLookupQuery.data.age ?? 'N/A'}</span>
                      <span className="rounded-md border border-border px-2 py-1">Gender: {patientLookupQuery.data.gender}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-surface/80 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-md border border-border px-2 py-1">Register: Organization-wide</span>
                    {selectedInstitutionId ? (
                      <span className="rounded-md border border-border px-2 py-1">Institution: {selectedInstitutionLabel || 'Selected institution'}</span>
                    ) : null}
                    {effectiveSelectedBranchId ? (
                      <span className="rounded-md border border-border px-2 py-1">Branch: {selectedBranchLabel || 'Selected branch'}</span>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {patientDetails.map((detail) => (
                      <div key={detail.label} className="rounded-xl border border-border/80 bg-white/60 p-3">
                        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{detail.label}</p>
                        <p className="mt-1 text-sm text-foreground">{detail.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {existingPatientQuery.isLoading ? (
                <LoadingSkeleton className="h-10 w-full" />
              ) : alreadyRegistered && effectiveSelectedBranchId ? (
                branchAlreadyAssigned ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    This patient is already in the organization register and already attached to the selected branch.
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This patient is already in the organization register but is not yet attached to the selected branch. Add the branch now to complete the branch attribution.
                  </div>
                )
              ) : alreadyRegistered && selectedInstitutionId ? (
                institutionAlreadyAssigned ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    This patient is already in the organization register and already associated with the selected institution.
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This patient is already in the organization register but is not yet associated with the selected institution. Add the institution now to save that intake attribution.
                  </div>
                )
              ) : alreadyRegistered ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  This patient is already in the organization register and should now appear in Patient Search anywhere in this organization.
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted">
                  {effectiveSelectedBranchId
                    ? 'The patient is not yet in the organization register for this branch. Add the patient now to enable search across the organization and tag the current branch.'
                    : selectedInstitutionId
                      ? 'The patient is not yet in the organization register for the selected institution. Add the patient now to enable search across the organization and save the institution attribution.'
                      : 'The patient is not yet in the organization register. Add the patient now to enable search anywhere in this organization.'}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    void onRegister();
                  }}
                  loading={registerPatient.isPending}
                  disabled={
                    (
                      effectiveSelectedBranchId
                        ? branchAlreadyAssigned
                        : selectedInstitutionId
                          ? institutionAlreadyAssigned
                          : alreadyRegistered
                    ) || !organizationId
                  }
                >
                  {effectiveSelectedBranchId ? 'Add Patient To Branch' : selectedInstitutionId ? 'Add Patient To Institution' : 'Add Patient To Organization'}
                </Button>
                <Button asChild variant="outline">
                  <Link to={`${basePath}/patients`}>Go To Patient Search</Link>
                </Button>
              </div>

              {registerPatient.isError ? (
                <p className="text-sm text-danger">
                  {registerPatient.error instanceof Error ? registerPatient.error.message : 'Unable to add patient right now.'}
                </p>
              ) : null}
              {registerPatient.isSuccess ? (
                <p className="text-sm text-emerald-700">
                  {effectiveSelectedBranchId
                    ? 'Patient added successfully. The patient is now available in Patient Search across the organization and tagged to the selected branch.'
                    : selectedInstitutionId
                      ? 'Patient added successfully. The patient is now available in Patient Search across the organization and associated with the selected institution.'
                      : 'Patient added successfully. The patient is now available in Patient Search across the organization.'}
                </p>
              ) : null}
            </div>
          </Card>
        ) : (
          <EmptyState
            title="No patient details found"
            description="Check the NIN and try again. Patient Intake starts from a valid NIN lookup."
          />
        )
      ) : null}
    </div>
  );
}
