import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type PatientProfile = {
  nin: string;
  name: string;
  age: number | null;
  gender: string;
  providerBadge: string;
  raw: Record<string, unknown>;
};

function toAge(dob?: string): number | null {
  if (!dob) return null;
  const parsed = /^\d{8}$/.test(dob)
    ? new Date(Number(dob.slice(4, 8)), Number(dob.slice(2, 4)) - 1, Number(dob.slice(0, 2)))
    : new Date(dob);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24 * 365.25)));
}

export function usePatientProfile(nin: string) {
  return useQuery({
    queryKey: ['provider', 'patient-profile', nin],
    enabled: Boolean(nin),
    queryFn: async (): Promise<PatientProfile> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.patientProfileByNin(nin));
      const profile =
        (response.profile as Record<string, unknown> | undefined) ??
        (response.data as Record<string, unknown> | undefined) ??
        response;

      const firstName = String(profile.firstName ?? '');
      const lastName = String(profile.lastName ?? '');
      const displayName = String(profile.displayName ?? [firstName, lastName].filter(Boolean).join(' ') ?? 'Patient');
      const gender = String(profile.gender ?? response.gender ?? 'N/A');
      const dob = String(profile.dob ?? '');

      return {
        nin: String(profile.nin ?? nin),
        name: displayName,
        age: toAge(dob),
        gender,
        providerBadge: 'Provider Access',
        raw: profile,
      };
    },
  });
}
