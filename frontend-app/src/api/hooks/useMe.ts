import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@/api/apiClient';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { toIdentityResponse } from '@/api/hooks/identityMapper';
import { queryClient } from '@/app/providers/queryClient';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useThemeStore } from '@/stores/themeStore';
import type { IdentityResponse } from '@/types/auth';

export const meQueryKey = ['identity', 'me'] as const;

async function fetchMe(): Promise<IdentityResponse> {
  try {
    const response = await apiClient.get<unknown>(endpoints.identity.me);
    return toIdentityResponse(response);
  } catch {
    const fallback = await apiClient.get<unknown>(endpoints.auth.meFallback);
    return toIdentityResponse(fallback);
  }
}

export function useMe(enabled = true) {
  const setUser = useAuthStore((state) => state.setUser);
  const clearSession = useAuthStore((state) => state.clearSession);
  const setAvailableContexts = useContextStore((state) => state.setAvailableContexts);
  const setActiveContext = useContextStore((state) => state.setActiveContext);
  const setRoles = usePermissionsStore((state) => state.setRoles);
  const loadTheme = useThemeStore((state) => state.loadTheme);

  const query = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!query.data) return;

    setUser(query.data.user);
    setAvailableContexts(query.data.availableContexts);
    const contextState = useContextStore.getState();
    const activeContext =
      contextState.activeContext && query.data.availableContexts.some((context) => context.id === contextState.activeContext?.id)
        ? contextState.activeContext
        : query.data.availableContexts.find((context) => context.id === query.data.defaultContextId) ??
          query.data.availableContexts[0] ??
          null;

    if (!contextState.activeContext && activeContext) {
      setActiveContext(activeContext);
    }
    setRoles(query.data.roles ?? []);

    if (activeContext) {
      void loadTheme(activeContext.themeScopeType, activeContext.themeScopeId);
    }
  }, [query.data, setUser, setAvailableContexts, setActiveContext, setRoles, loadTheme]);

  useEffect(() => {
    if (!query.error) return;
    if (query.error instanceof ApiClientError && query.error.status === 401) {
      clearSession();
      queryClient.removeQueries({ queryKey: meQueryKey });
    }
  }, [query.error, clearSession]);

  return query;
}
