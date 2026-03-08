import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type HealthMetricRow = {
  id: string;
  state: string;
  institution: string;
  provider: string;
  encounters: number;
  labs: number;
  prescriptions: number;
  complaints: number;
  emergencyEvents: number;
};

export type HealthMetricsData = {
  rows: HealthMetricRow[];
  total: number;
};

export function useHealthMetrics(filters: {
  from?: string;
  to?: string;
  state?: string;
  metric?: string;
  page: number;
  limit: number;
}) {
  return useQuery({
    queryKey: ['analytics', 'metrics', filters],
    queryFn: async (): Promise<HealthMetricsData> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.analytics.metrics, {
          query: {
            from: filters.from,
            to: filters.to,
            state: filters.state,
            metric: filters.metric,
            page: filters.page,
            limit: filters.limit,
          },
        });
        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        const rows = items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id ?? crypto.randomUUID()),
            state: String(item.state ?? 'N/A'),
            institution: String(item.institution ?? 'N/A'),
            provider: String(item.provider ?? 'N/A'),
            encounters: Number(item.encounters ?? 0),
            labs: Number(item.labs ?? 0),
            prescriptions: Number(item.prescriptions ?? 0),
            complaints: Number(item.complaints ?? 0),
            emergencyEvents: Number(item.emergencyEvents ?? 0),
          }));

        return {
          rows,
          total: Number(response.total ?? rows.length),
        };
      } catch {
        return { rows: [], total: 0 };
      }
    },
  });
}
