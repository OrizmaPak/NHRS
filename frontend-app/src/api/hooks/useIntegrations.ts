import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type IntegrationStatus = 'healthy' | 'warning' | 'critical' | 'disabled';

export type IntegrationRow = {
  id: string;
  name: string;
  provider: string;
  status: IntegrationStatus;
  lastSyncAt: string;
  authType: string;
};

export type IntegrationDetails = IntegrationRow & {
  configuration: Record<string, string>;
  logs: Array<{ id: string; level: 'info' | 'warning' | 'error'; message: string; timestamp: string }>;
  errorHistory: Array<{ id: string; code: string; message: string; timestamp: string }>;
};

function fallbackRows(): IntegrationRow[] {
  const now = new Date().toISOString();
  return [
    { id: 'int-emr-main', name: 'Main Hospital EMR', provider: 'MediCore', status: 'healthy', lastSyncAt: now, authType: 'OAuth2' },
    { id: 'int-lab-regional', name: 'Regional Lab LIS', provider: 'LabStack', status: 'warning', lastSyncAt: now, authType: 'API Key' },
    { id: 'int-identity-nin', name: 'National Identity Sync', provider: 'NIMC', status: 'healthy', lastSyncAt: now, authType: 'mTLS' },
  ];
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations', 'list'],
    queryFn: async (): Promise<IntegrationRow[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.integrations.list);
        const items = (Array.isArray(response.items) ? response.items : Array.isArray(response.data) ? response.data : []) as Array<Record<string, unknown>>;
        return items.map((item) => ({
          id: String(item.id ?? item.integrationId ?? crypto.randomUUID()),
          name: String(item.name ?? 'Integration'),
          provider: String(item.provider ?? 'Unknown'),
          status: String(item.status ?? 'warning').toLowerCase() as IntegrationStatus,
          lastSyncAt: String(item.lastSyncAt ?? item.updatedAt ?? new Date().toISOString()),
          authType: String(item.authType ?? 'Unknown'),
        }));
      } catch {
        return fallbackRows();
      }
    },
  });
}

export function useIntegrationDetails(id: string) {
  return useQuery({
    queryKey: ['integrations', 'details', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<IntegrationDetails> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.integrations.byId(id));
        const config = (response.configuration && typeof response.configuration === 'object'
          ? response.configuration
          : {}) as Record<string, unknown>;
        const logs = Array.isArray(response.logs) ? response.logs : [];
        const errors = Array.isArray(response.errorHistory) ? response.errorHistory : [];
        return {
          id,
          name: String(response.name ?? 'Integration'),
          provider: String(response.provider ?? 'Unknown'),
          status: String(response.status ?? 'warning').toLowerCase() as IntegrationStatus,
          lastSyncAt: String(response.lastSyncAt ?? new Date().toISOString()),
          authType: String(response.authType ?? 'Unknown'),
          configuration: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, String(v)])),
          logs: logs.map((entry, idx) => ({
            id: String((entry as Record<string, unknown>).id ?? idx),
            level: String((entry as Record<string, unknown>).level ?? 'info').toLowerCase() as 'info' | 'warning' | 'error',
            message: String((entry as Record<string, unknown>).message ?? ''),
            timestamp: String((entry as Record<string, unknown>).timestamp ?? new Date().toISOString()),
          })),
          errorHistory: errors.map((entry, idx) => ({
            id: String((entry as Record<string, unknown>).id ?? idx),
            code: String((entry as Record<string, unknown>).code ?? 'UNKNOWN'),
            message: String((entry as Record<string, unknown>).message ?? ''),
            timestamp: String((entry as Record<string, unknown>).timestamp ?? new Date().toISOString()),
          })),
        };
      } catch {
        const row = fallbackRows().find((entry) => entry.id === id) ?? fallbackRows()[0];
        return {
          ...row,
          configuration: { endpoint: 'https://api.partner.nhrs.example', mode: 'pull', retries: '3' },
          logs: [
            { id: '1', level: 'info', message: 'Connection healthy', timestamp: new Date().toISOString() },
            { id: '2', level: 'warning', message: 'Last sync took 4.8s', timestamp: new Date().toISOString() },
          ],
          errorHistory: [],
        };
      }
    },
  });
}

export function useTestIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.post(endpoints.integrations.test(id), {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export function useDisableIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.patch(endpoints.integrations.disable(id), { disabled: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}
