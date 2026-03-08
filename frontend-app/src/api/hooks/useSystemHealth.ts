import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type SystemHealth = {
  services: Array<{ name: string; status: 'healthy' | 'degraded' | 'down'; latencyMs?: number }>;
  errors: Array<{ id: string; service: string; message: string; timestamp: string }>;
  slowQueries: Array<{ id: string; service: string; operation: string; durationMs: number; timestamp: string }>;
};

export function useSystemHealth() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: async (): Promise<SystemHealth> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.system.health);
        return {
          services: Array.isArray(response.services)
            ? (response.services as Array<Record<string, unknown>>).map((item) => ({
                name: String(item.name ?? 'service'),
                status: String(item.status ?? 'degraded').toLowerCase() as SystemHealth['services'][number]['status'],
                latencyMs: item.latencyMs ? Number(item.latencyMs) : undefined,
              }))
            : [],
          errors: Array.isArray(response.errors)
            ? (response.errors as Array<Record<string, unknown>>).map((item) => ({
                id: String(item.id ?? crypto.randomUUID()),
                service: String(item.service ?? 'service'),
                message: String(item.message ?? 'Unknown error'),
                timestamp: String(item.timestamp ?? new Date().toISOString()),
              }))
            : [],
          slowQueries: Array.isArray(response.slowQueries)
            ? (response.slowQueries as Array<Record<string, unknown>>).map((item) => ({
                id: String(item.id ?? crypto.randomUUID()),
                service: String(item.service ?? 'service'),
                operation: String(item.operation ?? 'query'),
                durationMs: Number(item.durationMs ?? 0),
                timestamp: String(item.timestamp ?? new Date().toISOString()),
              }))
            : [],
        };
      } catch {
        return { services: [], errors: [], slowQueries: [] };
      }
    },
    refetchInterval: 30000,
  });
}
