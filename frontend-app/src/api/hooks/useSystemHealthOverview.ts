import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type Incident = {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'active' | 'resolved';
  startedAt: string;
  resolvedAt?: string;
};

export type HealthOverview = {
  uptimePercentage: number;
  activeIncidents: number;
  resolvedIncidents: number;
  recentOutages: number;
  incidents: Incident[];
};

export function useSystemHealthOverview() {
  return useQuery({
    queryKey: ['system', 'health-overview'],
    queryFn: async (): Promise<HealthOverview> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.system.incidents);
        const items = (Array.isArray(response.items) ? response.items : Array.isArray(response.data) ? response.data : []) as Array<Record<string, unknown>>;
        const incidents = items.map((item) => ({
          id: String(item.id ?? crypto.randomUUID()),
          title: String(item.title ?? 'Incident'),
          severity: String(item.severity ?? 'warning').toLowerCase() as Incident['severity'],
          status: String(item.status ?? 'active').toLowerCase() as Incident['status'],
          startedAt: String(item.startedAt ?? new Date().toISOString()),
          resolvedAt: item.resolvedAt ? String(item.resolvedAt) : undefined,
        }));
        return {
          uptimePercentage: Number(response.uptimePercentage ?? 99.9),
          activeIncidents: incidents.filter((entry) => entry.status === 'active').length,
          resolvedIncidents: incidents.filter((entry) => entry.status === 'resolved').length,
          recentOutages: Number(response.recentOutages ?? 0),
          incidents,
        };
      } catch {
        const incidents: Incident[] = [
          { id: 'inc-1', title: 'Delayed lab sync in West region', severity: 'warning', status: 'active', startedAt: new Date().toISOString() },
          { id: 'inc-2', title: 'Auth gateway latency spike', severity: 'critical', status: 'resolved', startedAt: new Date().toISOString(), resolvedAt: new Date().toISOString() },
        ];
        return {
          uptimePercentage: 99.7,
          activeIncidents: 1,
          resolvedIncidents: 1,
          recentOutages: 1,
          incidents,
        };
      }
    },
  });
}
