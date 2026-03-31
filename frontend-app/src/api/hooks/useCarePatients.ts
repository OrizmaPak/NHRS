import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { resolvePatientDisplayName } from '@/lib/patientDisplay';

export type CarePatientSearchParams = {
  q?: string;
  nin?: string;
  page: number;
  limit: number;
  organizationId?: string;
  institutionId?: string;
};

export type CarePatientRow = {
  registryId: string;
  organizationId: string;
  institutionId: string;
  institutionIds?: string[];
  branchId?: string;
  branchIds?: string[];
  nin: string;
  patientName: string;
  age: number | null;
  gender: string;
  lastActivity: string;
};

type CarePatientSearchResult = {
  rows: CarePatientRow[];
  total: number;
};

function calculateAge(dob?: string): number | null {
  if (!dob) return null;
  const raw = String(dob);
  const parsed =
    /^\d{8}$/.test(raw)
      ? new Date(Number(raw.slice(4, 8)), Number(raw.slice(2, 4)) - 1, Number(raw.slice(0, 2)))
      : new Date(raw);

  if (Number.isNaN(parsed.getTime())) return null;
  const diff = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)));
}

function mapCarePatient(item: Record<string, unknown>): CarePatientRow {
  const nin = String(item.nin ?? 'N/A');

  return {
    registryId: String(item.registryId ?? item.id ?? nin),
    organizationId: String(item.organizationId ?? ''),
    institutionId: String(item.institutionId ?? ''),
    institutionIds: Array.isArray(item.institutionIds)
      ? item.institutionIds.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : undefined,
    branchId: String(item.branchId ?? '') || undefined,
    branchIds: Array.isArray(item.branchIds)
      ? item.branchIds.map((entry) => String(entry ?? '').trim()).filter(Boolean)
      : undefined,
    nin,
    patientName: resolvePatientDisplayName(item, nin),
    age: calculateAge(String(item.dob ?? '')),
    gender: String(item.gender ?? 'N/A'),
    lastActivity: String(item.updatedAt ?? item.createdAt ?? new Date().toISOString()),
  };
}

export function useCarePatients(params: CarePatientSearchParams, enabled = true) {
  return useQuery({
    queryKey: ['care', 'patients', params],
    enabled: enabled && Boolean(params.organizationId),
    queryFn: async (): Promise<CarePatientSearchResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.care.patients, {
        query: {
          q: params.q,
          nin: params.nin,
          page: params.page,
          limit: params.limit,
          organizationId: params.organizationId,
          institutionId: params.institutionId,
        },
      });

      const items = Array.isArray(response.items) ? response.items : [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(mapCarePatient);

      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

type RegisterCarePatientPayload = {
  nin: string;
  organizationId: string;
  institutionId?: string;
  branchId?: string;
};

export function useRegisterCarePatient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: RegisterCarePatientPayload) =>
      apiClient.post<Record<string, unknown>>(endpoints.care.registerPatient, payload),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['care', 'patients'] });
      await queryClient.invalidateQueries({ queryKey: ['provider', 'patient-profile', variables.nin] });
    },
  });
}
