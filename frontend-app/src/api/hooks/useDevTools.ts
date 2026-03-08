import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type DevToolsData = {
  requestLogs: Array<{ id: string; method: string; path: string; status: number; durationMs: number; timestamp: string }>;
  integrationCalls: Array<{ id: string; integration: string; result: string; timestamp: string }>;
  testEndpoints: Array<{ id: string; name: string; path: string; health: 'healthy' | 'warning' | 'critical' }>;
};

export function useDevTools() {
  return useQuery({
    queryKey: ['system', 'dev-tools'],
    queryFn: async (): Promise<DevToolsData> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.system.devTools);
        const mapRows = (value: unknown): Array<Record<string, unknown>> =>
          Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object')) : [];
        return {
          requestLogs: mapRows(response.requestLogs).map((entry) => ({
            id: String(entry.id ?? crypto.randomUUID()),
            method: String(entry.method ?? 'GET'),
            path: String(entry.path ?? '/'),
            status: Number(entry.status ?? 200),
            durationMs: Number(entry.durationMs ?? 0),
            timestamp: String(entry.timestamp ?? new Date().toISOString()),
          })),
          integrationCalls: mapRows(response.integrationCalls).map((entry) => ({
            id: String(entry.id ?? crypto.randomUUID()),
            integration: String(entry.integration ?? 'Unknown'),
            result: String(entry.result ?? 'success'),
            timestamp: String(entry.timestamp ?? new Date().toISOString()),
          })),
          testEndpoints: mapRows(response.testEndpoints).map((entry) => ({
            id: String(entry.id ?? crypto.randomUUID()),
            name: String(entry.name ?? 'Endpoint'),
            path: String(entry.path ?? '/health'),
            health: String(entry.health ?? 'healthy').toLowerCase() as 'healthy' | 'warning' | 'critical',
          })),
        };
      } catch {
        return {
          requestLogs: [],
          integrationCalls: [],
          testEndpoints: [
            { id: '1', name: 'Auth Health', path: '/auth/health', health: 'healthy' },
            { id: '2', name: 'Gateway OpenAPI', path: '/openapi.json', health: 'healthy' },
          ],
        };
      }
    },
    refetchInterval: 20000,
  });
}
