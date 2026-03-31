import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { resolvePatientDisplayName } from '@/lib/patientDisplay';

const PATIENT_CARE_VIEW = 'patient-care';
type PatientSearchViewMode = 'default' | typeof PATIENT_CARE_VIEW;

export type PatientSearchParams = {
  q?: string;
  nin?: string;
  dob?: string;
  page: number;
  limit: number;
  viewMode?: PatientSearchViewMode;
  organizationId?: string;
  enabled?: boolean;
};

export type PatientSearchRow = {
  nin: string;
  patientName: string;
  age: number | null;
  gender: string;
  lastActivity: string;
};

type PatientSearchResult = {
  rows: PatientSearchRow[];
  total: number;
};

function calculateAge(dob?: string): number | null {
  if (!dob) return null;
  const raw = String(dob);
  // Supports DDMMYYYY and ISO dates.
  const parsed =
    /^\d{8}$/.test(raw)
      ? new Date(Number(raw.slice(4, 8)), Number(raw.slice(2, 4)) - 1, Number(raw.slice(0, 2)))
      : new Date(raw);

  if (Number.isNaN(parsed.getTime())) return null;
  const diff = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)));
}

function mapPatient(item: Record<string, unknown>): PatientSearchRow {
  const nin = String(item.nin ?? 'N/A');
  const name = resolvePatientDisplayName(item, nin);

  return {
    nin,
    patientName: String(name),
    age: calculateAge(String(item.dob ?? '')),
    gender: String(item.gender ?? 'N/A'),
    lastActivity: String(item.updatedAt ?? item.lastActivity ?? new Date().toISOString()),
  };
}

function mapPatientProfile(profile: Record<string, unknown>, fallbackNin?: string): PatientSearchRow {
  const displayName = resolvePatientDisplayName(profile, fallbackNin);

  return {
    nin: String(profile.nin ?? fallbackNin ?? 'N/A'),
    patientName: displayName,
    age: calculateAge(String(profile.dob ?? '')),
    gender: String(profile.gender ?? 'N/A'),
    lastActivity: String(profile.updatedAt ?? new Date().toISOString()),
  };
}

export function usePatientSearch(params: PatientSearchParams) {
  const query: Record<string, string | number | undefined> = {
    q: params.q,
    nin: params.nin,
    dob: params.dob,
    page: params.page,
    limit: params.limit,
    organizationId: params.organizationId,
  };
  if (params.viewMode === PATIENT_CARE_VIEW) {
    query.view = PATIENT_CARE_VIEW;
  }

  return useQuery({
    queryKey: ['provider', 'patient-search', params],
    enabled: params.enabled ?? true,
    queryFn: async (): Promise<PatientSearchResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.patientSearch, {
        query,
      });

      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      let rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(mapPatient);

      if (rows.length === 0 && /^\d{11}$/.test(String(params.nin ?? ''))) {
        const patientResponse = await apiClient.get<Record<string, unknown>>(endpoints.provider.patientProfileByNin(String(params.nin)), {
          query: params.viewMode === PATIENT_CARE_VIEW ? { view: PATIENT_CARE_VIEW } : undefined,
        });
        const fallbackProfile =
          (patientResponse.profile as Record<string, unknown> | undefined) ??
          (patientResponse.ninSummary as Record<string, unknown> | undefined);
        if (fallbackProfile) {
          rows = [mapPatientProfile(fallbackProfile, String(params.nin))];
        }
      }

      return {
        rows,
        total: rows.length > 0 ? Math.max(Number(response.total ?? 0), rows.length) : Number(response.total ?? rows.length),
      };
    },
  });
}
