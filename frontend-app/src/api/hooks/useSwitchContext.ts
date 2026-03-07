import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, ApiClientError } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { queryClient } from '@/app/providers/queryClient';
import { ALLOW_CONTEXT_SWITCH_FALLBACK } from '@/lib/constants';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useThemeStore } from '@/stores/themeStore';

export function useSwitchContext() {
  const switchContext = useContextStore((state) => state.switchContext);
  const replacePermissions = usePermissionsStore((state) => state.replace);
  const loadTheme = useThemeStore((state) => state.loadTheme);

  return useMutation({
    mutationFn: async (contextId: string) => {
      try {
        await apiClient.post(endpoints.identity.switchContext, { contextId });
      } catch (error) {
        const isNotFound = error instanceof ApiClientError && error.status === 404;
        if (!isNotFound || !ALLOW_CONTEXT_SWITCH_FALLBACK) {
          throw error;
        }
      }

      const next = switchContext(contextId);
      if (!next) throw new Error('Context not found');

      replacePermissions(next.permissions);
      await loadTheme(next.themeScopeType, next.themeScopeId);
      await queryClient.invalidateQueries();

      return next;
    },
    onSuccess: (context) => {
      toast.success(`Switched to ${context.name}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Unable to switch context');
    },
  });
}
