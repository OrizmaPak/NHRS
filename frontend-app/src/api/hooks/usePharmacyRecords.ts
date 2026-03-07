import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { ProviderRecordParams } from '@/api/hooks/useEncounters';

export type PharmacyRow = {
  id: string;
  date: string;
  medication: string;
  dosage: string;
  provider: string;
};

type PharmacyResult = {
  rows: PharmacyRow[];
  total: number;
};

export function usePharmacyRecords(nin: string, params: ProviderRecordParams) {
  return useQuery({
    queryKey: ['provider', 'pharmacy', nin, params],
    enabled: Boolean(nin),
    queryFn: async (): Promise<PharmacyResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.provider.pharmacyByNin(nin), {
        query: { page: params.page, limit: params.limit, from: params.from, to: params.to },
      });
      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const firstItem =
            Array.isArray(item.items) && item.items.length > 0 && typeof item.items[0] === 'object'
              ? (item.items[0] as Record<string, unknown>)
              : null;
          return {
            id: String(item.dispenseId ?? item.id ?? crypto.randomUUID()),
            date: String(item.createdAt ?? new Date().toISOString()),
            medication: String(firstItem?.drugName ?? 'Medication'),
            dosage: String(firstItem?.dosage ?? firstItem?.frequency ?? 'As prescribed'),
            provider: String(item.organizationId ?? 'provider'),
          };
        });
      return { rows, total: Number(response.total ?? rows.length) };
    },
  });
}
