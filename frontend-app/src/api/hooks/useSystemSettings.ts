import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type SystemSettingGroup = {
  id: string;
  title: string;
  settings: Array<{ key: string; value: string | number | boolean; description?: string }>;
};

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system', 'settings'],
    queryFn: async (): Promise<SystemSettingGroup[]> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.system.configuration);
        const groups =
          (Array.isArray(response.groups) ? response.groups : null) ??
          (Array.isArray(response.data) ? response.data : null) ??
          [];

        return groups
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((group) => ({
            id: String(group.id ?? group.key ?? crypto.randomUUID()),
            title: String(group.title ?? 'Configuration'),
            settings: Array.isArray(group.settings)
              ? (group.settings as Array<Record<string, unknown>>).map((setting) => ({
                  key: String(setting.key ?? 'setting'),
                  value:
                    typeof setting.value === 'boolean' ||
                    typeof setting.value === 'number' ||
                    typeof setting.value === 'string'
                      ? setting.value
                      : String(setting.value ?? ''),
                  description: setting.description ? String(setting.description) : undefined,
                }))
              : [],
          }));
      } catch {
        return [];
      }
    },
  });
}

export function useSaveSystemSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { groups: SystemSettingGroup[] }) =>
      apiClient.patch(endpoints.system.configuration, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['system', 'settings'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
      ]);
    },
  });
}
