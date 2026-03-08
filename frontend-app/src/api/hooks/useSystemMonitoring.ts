import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type SystemMonitoringData = {
  apiHealth: 'healthy' | 'warning' | 'critical';
  databaseStatus: 'healthy' | 'warning' | 'critical';
  queueStatus: 'healthy' | 'warning' | 'critical';
  backgroundJobs: 'healthy' | 'warning' | 'critical';
  recentErrors: Array<{ id: string; service: string; error: string; timestamp: string }>;
  failedCalls: Array<{ id: string; endpoint: string; status: number; count: number; timestamp: string }>;
  slowRequests: Array<{ id: string; endpoint: string; latencyMs: number; timestamp: string }>;
};

export function useSystemMonitoring() {
  return useQuery({
    queryKey: ['system', 'monitoring'],
    queryFn: async (): Promise<SystemMonitoringData> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.system.monitoring);
        const mapRows = (value: unknown): Array<Record<string, unknown>> =>
          Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object')) : [];
        return {
          apiHealth: String(response.apiHealth ?? 'healthy').toLowerCase() as SystemMonitoringData['apiHealth'],
          databaseStatus: String(response.databaseStatus ?? 'healthy').toLowerCase() as SystemMonitoringData['databaseStatus'],
          queueStatus: String(response.queueStatus ?? 'healthy').toLowerCase() as SystemMonitoringData['queueStatus'],
          backgroundJobs: String(response.backgroundJobs ?? 'healthy').toLowerCase() as SystemMonitoringData['backgroundJobs'],
          recentErrors: mapRows(response.recentErrors).map((row) => ({
            id: String(row.id ?? crypto.randomUUID()),
            service: String(row.service ?? 'unknown'),
            error: String(row.error ?? row.message ?? ''),
            timestamp: String(row.timestamp ?? new Date().toISOString()),
          })),
          failedCalls: mapRows(response.failedCalls).map((row) => ({
            id: String(row.id ?? crypto.randomUUID()),
            endpoint: String(row.endpoint ?? ''),
            status: Number(row.status ?? 500),
            count: Number(row.count ?? 0),
            timestamp: String(row.timestamp ?? new Date().toISOString()),
          })),
          slowRequests: mapRows(response.slowRequests).map((row) => ({
            id: String(row.id ?? crypto.randomUUID()),
            endpoint: String(row.endpoint ?? ''),
            latencyMs: Number(row.latencyMs ?? 0),
            timestamp: String(row.timestamp ?? new Date().toISOString()),
          })),
        };
      } catch {
        return {
          apiHealth: 'healthy',
          databaseStatus: 'healthy',
          queueStatus: 'warning',
          backgroundJobs: 'healthy',
          recentErrors: [],
          failedCalls: [],
          slowRequests: [],
        };
      }
    },
    refetchInterval: 30000,
  });
}
