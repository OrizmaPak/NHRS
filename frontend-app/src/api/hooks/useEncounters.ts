import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type ProviderRecordParams = {
  page: number;
  limit: number;
  from?: string;
  to?: string;
};

export type EncounterRow = {
  id: string;
  date: string;
  visitType: string;
  diagnosis: string;
  provider: string;
};

type EncounterResult = {
  rows: EncounterRow[];
  total: number;
};

export function useEncounters(nin: string, params: ProviderRecordParams) {
  return useQuery({
    queryKey: ['provider', 'encounters', nin, params],
    enabled: Boolean(nin),
    queryFn: async (): Promise<EncounterResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.encountersByNin(nin), {
        query: { page: params.page, limit: params.limit, from: params.from, to: params.to },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id: String(item.encounterId ?? item.id ?? crypto.randomUUID()),
          date: String(item.createdAt ?? item.updatedAt ?? new Date().toISOString()),
          visitType: String(item.visitType ?? 'outpatient'),
          diagnosis: String(item.diagnosisText ?? item.chiefComplaint ?? 'N/A'),
          provider: String(item.organizationId ?? 'provider'),
        }));
      return { rows, total: Number(response.total ?? rows.length) };
    },
  });
}
