import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  institution: string;
  status: string;
};

export function useAdminUsers(params: { page: number; limit: number; q?: string }) {
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: async (): Promise<{ rows: AdminUser[]; total: number }> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.admin.users, {
          query: {
            page: params.page,
            limit: params.limit,
            q: params.q,
          },
        });
        const items =
          (Array.isArray(response.items) ? response.items : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        const rows = items
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id ?? item.userId ?? crypto.randomUUID()),
            name: String(item.name ?? item.fullName ?? 'Unknown user'),
            email: String(item.email ?? 'N/A'),
            role: String(item.role ?? item.roles ?? 'N/A'),
            institution: String(item.institution ?? 'N/A'),
            status: String(item.status ?? 'active'),
          }));

        return { rows, total: Number(response.total ?? rows.length) };
      } catch {
        return { rows: [], total: 0 };
      }
    },
  });
}

export function useSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => apiClient.patch(endpoints.admin.userById(userId), { status: 'suspended' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
