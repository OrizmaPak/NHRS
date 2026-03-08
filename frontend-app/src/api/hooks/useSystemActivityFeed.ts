import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type SystemActivityItem = {
  id: string;
  actor: string;
  action: string;
  module: string;
  target: string;
  institution: string;
  timestamp: string;
};

export type SystemActivityParams = {
  module?: string;
  actor?: string;
  institution?: string;
  from?: string;
  to?: string;
};

export function useSystemActivityFeed(params: SystemActivityParams = {}) {
  return useQuery({
    queryKey: ['system', 'activity', params],
    queryFn: async (): Promise<SystemActivityItem[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.system.activity, {
          query: {
            module: params.module,
            actor: params.actor,
            institution: params.institution,
            from: params.from,
            to: params.to,
          },
        });

        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        return items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id ?? item.eventId ?? crypto.randomUUID()),
            actor: String(item.actor ?? item.userId ?? 'System'),
            action: String(item.action ?? item.eventType ?? 'updated'),
            module: String(item.module ?? item.sourceService ?? 'system'),
            target: String(item.target ?? item.resourceId ?? item.resourceType ?? 'entity'),
            institution: String(item.institution ?? item.organizationId ?? 'N/A'),
            timestamp: String(item.timestamp ?? item.createdAt ?? new Date().toISOString()),
          }));
      } catch {
        return [];
      }
    },
  });
}

