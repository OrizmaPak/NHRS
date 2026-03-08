import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type AlertItem = {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  scope: string;
  type: string;
  affectedInstitutions: string[];
  createdAt: string;
  description: string;
};

export type AlertsParams = {
  severity?: string;
  scope?: string;
  type?: string;
};

export function useAlerts(params: AlertsParams = {}) {
  return useQuery({
    queryKey: ['system', 'alerts', params],
    queryFn: async (): Promise<AlertItem[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.alerts.list, {
          query: {
            severity: params.severity,
            scope: params.scope,
            type: params.type,
          },
        });

        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        return items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id ?? item.alertId ?? crypto.randomUUID()),
            title: String(item.title ?? item.name ?? 'System Alert'),
            severity: String(item.severity ?? item.priority ?? 'info').toLowerCase() as AlertItem['severity'],
            scope: String(item.scope ?? item.scopeLevel ?? 'national'),
            type: String(item.type ?? 'general'),
            affectedInstitutions: Array.isArray(item.affectedInstitutions)
              ? item.affectedInstitutions.map((entry) => String(entry))
              : [],
            createdAt: String(item.createdAt ?? new Date().toISOString()),
            description: String(item.description ?? ''),
          }));
      } catch {
        return [];
      }
    },
  });
}

