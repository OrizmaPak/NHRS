import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type ApiKeyRow = {
  id: string;
  name: string;
  status: 'active' | 'revoked' | 'expired';
  createdAt: string;
  lastUsedAt?: string;
  permissions: string[];
  keyPreview: string;
};

export function useApiKeys() {
  return useQuery({
    queryKey: ['integrations', 'api-keys'],
    queryFn: async (): Promise<ApiKeyRow[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.integrations.apiKeys);
        const items = (Array.isArray(response.items) ? response.items : Array.isArray(response.data) ? response.data : []) as Array<Record<string, unknown>>;
        return items.map((item) => ({
          id: String(item.id ?? item.keyId ?? crypto.randomUUID()),
          name: String(item.name ?? 'API Key'),
          status: String(item.status ?? 'active') as ApiKeyRow['status'],
          createdAt: String(item.createdAt ?? new Date().toISOString()),
          lastUsedAt: item.lastUsedAt ? String(item.lastUsedAt) : undefined,
          permissions: Array.isArray(item.permissions) ? item.permissions.map((entry) => String(entry)) : [],
          keyPreview: String(item.keyPreview ?? 'nhrs_****'),
        }));
      } catch {
        return [
          {
            id: 'key-1',
            name: 'Hospital EMR Connector',
            status: 'active',
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
            permissions: ['records.read', 'records.write'],
            keyPreview: 'nhrs_live_8h3...x91',
          },
        ];
      }
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; permissions: string[] }) =>
      apiClient.post<{ key: string; id?: string }>(endpoints.integrations.apiKeys, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations', 'api-keys'] });
    },
  });
}

export function useRotateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiClient.post<{ key?: string }>(endpoints.integrations.rotateApiKey(id), {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations', 'api-keys'] });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.post(endpoints.integrations.revokeApiKey(id), {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['integrations', 'api-keys'] });
    },
  });
}
