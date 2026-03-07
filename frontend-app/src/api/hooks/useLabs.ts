import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { ProviderRecordParams } from '@/api/hooks/useEncounters';

export type LabRow = {
  id: string;
  date: string;
  testName: string;
  interpretation: string;
  provider: string;
};

type LabResult = {
  rows: LabRow[];
  total: number;
};

export function useLabs(nin: string, params: ProviderRecordParams) {
  return useQuery({
    queryKey: ['provider', 'labs', nin, params],
    enabled: Boolean(nin),
    queryFn: async (): Promise<LabResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.labsByNin(nin), {
        query: { page: params.page, limit: params.limit, from: params.from, to: params.to },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id: String(item.resultId ?? item.id ?? crypto.randomUUID()),
          date: String(item.createdAt ?? new Date().toISOString()),
          testName: String(item.testName ?? 'Lab result'),
          interpretation: String(item.interpretation ?? 'Pending interpretation'),
          provider: String(item.organizationId ?? 'provider'),
        }));
      return { rows, total: Number(response.total ?? rows.length) };
    },
  });
}
