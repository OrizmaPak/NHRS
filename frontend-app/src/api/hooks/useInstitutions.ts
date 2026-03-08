import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type InstitutionRow = {
  id: string;
  name: string;
  type: string;
  state: string;
  lga: string;
  status: string;
};

export function useInstitutions(params: { page: number; limit: number; q?: string }) {
  return useQuery({
    queryKey: ['admin', 'institutions', params],
    queryFn: async (): Promise<{ rows: InstitutionRow[]; total: number }> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.admin.institutions, {
          query: {
            page: params.page,
            limit: params.limit,
            q: params.q,
          },
        });

        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        const rows = items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id ?? item.organizationId ?? crypto.randomUUID()),
            name: String(item.name ?? 'Institution'),
            type: String(item.type ?? 'general'),
            state: String(item.state ?? 'N/A'),
            lga: String(item.lga ?? 'N/A'),
            status: String(item.status ?? 'active'),
          }));

        return { rows, total: Number(response.total ?? rows.length) };
      } catch {
        return { rows: [], total: 0 };
      }
    },
  });
}
