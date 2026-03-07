import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type PatientSearchParams = {
  q?: string;
  nin?: string;
  dob?: string;
  page: number;
  limit: number;
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
  const name =
    item.displayName ??
    [item.firstName, item.lastName].filter(Boolean).join(' ') ??
    item.name ??
    'Unknown patient';

  return {
    nin: String(item.nin ?? 'N/A'),
    patientName: String(name),
    age: calculateAge(String(item.dob ?? '')),
    gender: String(item.gender ?? 'N/A'),
    lastActivity: String(item.updatedAt ?? item.lastActivity ?? new Date().toISOString()),
  };
}

export function usePatientSearch(params: PatientSearchParams) {
  return useQuery({
    queryKey: ['provider', 'patient-search', params],
    queryFn: async (): Promise<PatientSearchResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.patientSearch, {
        query: {
          q: params.q,
          nin: params.nin,
          dob: params.dob,
          page: params.page,
          limit: params.limit,
        },
      });

      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(mapPatient);

      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}
