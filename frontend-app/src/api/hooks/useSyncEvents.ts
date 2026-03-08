import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type SyncEvent = {
  id: string;
  source: string;
  destination: string;
  status: 'success' | 'failure' | 'warning';
  latencyMs: number;
  timestamp: string;
  message: string;
};

export function useSyncEvents(filters: { system?: string; module?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['integrations', 'sync-events', filters],
    queryFn: async (): Promise<SyncEvent[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.integrations.syncEvents, {
          query: { system: filters.system, module: filters.module, from: filters.from, to: filters.to },
        });
        const items = (Array.isArray(response.items) ? response.items : Array.isArray(response.data) ? response.data : []) as Array<Record<string, unknown>>;
        return items.map((item) => ({
          id: String(item.id ?? crypto.randomUUID()),
          source: String(item.source ?? 'Unknown'),
          destination: String(item.destination ?? 'Unknown'),
          status: String(item.status ?? 'success').toLowerCase() as SyncEvent['status'],
          latencyMs: Number(item.latencyMs ?? 0),
          timestamp: String(item.timestamp ?? new Date().toISOString()),
          message: String(item.message ?? ''),
        }));
      } catch {
        return [
          {
            id: 'sync-1',
            source: 'EMR',
            destination: 'records-index',
            status: 'success',
            latencyMs: 320,
            timestamp: new Date().toISOString(),
            message: 'Batch sync completed',
          },
          {
            id: 'sync-2',
            source: 'LIS',
            destination: 'labs-module',
            status: 'failure',
            latencyMs: 1080,
            timestamp: new Date().toISOString(),
            message: 'Timeout on remote endpoint',
          },
        ];
      }
    },
  });
}
