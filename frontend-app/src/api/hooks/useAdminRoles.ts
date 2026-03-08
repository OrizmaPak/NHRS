import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type AdminRole = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
};

export function useAdminRoles() {
  return useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: async (): Promise<AdminRole[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.admin.roles);
        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        return items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id ?? item.roleId ?? crypto.randomUUID()),
            name: String(item.name ?? 'role'),
            description: String(item.description ?? ''),
            permissions: Array.isArray(item.permissions)
              ? item.permissions.map((entry) => String(entry))
              : [],
          }));
      } catch {
        return [];
      }
    },
  });
}

export function useSaveAdminRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id?: string; name: string; description: string; permissions: string[] }) =>
      payload.id
        ? apiClient.patch(endpoints.admin.roleById(payload.id), payload)
        : apiClient.post(endpoints.admin.roles, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}
