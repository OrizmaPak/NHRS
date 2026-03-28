import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type GlobalServiceRow = {
  serviceId: string;
  name: string;
  description: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function startCaseWords(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function normalizeGlobalServiceName(value: unknown): string {
  return startCaseWords(String(value || ''));
}

export function getGlobalServiceKey(value: unknown): string {
  return normalizeGlobalServiceName(value).toLowerCase();
}

export function mergeGlobalServiceNames(values: unknown[]): string[] {
  const seen = new Set<string>();
  return (Array.isArray(values) ? values : [])
    .map((entry) => normalizeGlobalServiceName(entry))
    .filter((entry) => {
      if (!entry) return false;
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mapGlobalServiceRow(raw: unknown): GlobalServiceRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const serviceId = String(row.serviceId || '').trim();
  const name = normalizeGlobalServiceName(row.name);
  if (!serviceId || !name) return null;
  return {
    serviceId,
    name,
    description: String(row.description || '').trim(),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  };
}

export function useGlobalServices(params?: { q?: string; limit?: number }) {
  return useQuery({
    queryKey: ['catalog', 'global-services', params?.q || '', params?.limit || 200],
    queryFn: async (): Promise<{ rows: GlobalServiceRow[]; total: number }> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.catalog.globalServices, {
        query: {
          q: params?.q && params.q.trim().length > 0 ? params.q.trim() : undefined,
          limit: params?.limit || 200,
        },
      });
      const items = Array.isArray(response.items) ? response.items : [];
      const rows = items.map(mapGlobalServiceRow).filter((entry): entry is GlobalServiceRow => Boolean(entry));
      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

export function useCreateGlobalService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; description: string }) =>
      apiClient.post<{ service?: unknown }>(endpoints.catalog.globalServices, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'global-services'] });
    },
  });
}

export function useDeleteGlobalService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serviceId: string) =>
      apiClient.delete<{ message?: string }>(endpoints.catalog.globalServiceById(serviceId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'global-services'] });
    },
  });
}
