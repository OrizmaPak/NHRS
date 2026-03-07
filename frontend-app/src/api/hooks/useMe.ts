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
  const replacePermissions = usePermissionsStore((state) => state.replace);
  const loadTheme = useThemeStore((state) => state.loadTheme);

  const query = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    enabled,
    retry: false,
  });

  useEffect(() => {
    if (!query.data) return;

    setUser(query.data.user);
    setAvailableContexts(query.data.availableContexts);

    const preferredContext =
      query.data.availableContexts.find((context) => context.id === query.data.defaultContextId) ??
      query.data.availableContexts[0] ??
      null;

    setActiveContext(preferredContext);
    const contextPermissions = Array.isArray(preferredContext?.permissions) ? preferredContext.permissions : [];
    replacePermissions(contextPermissions.length > 0 ? contextPermissions : query.data.permissions);

    if (preferredContext) {
      void loadTheme(preferredContext.themeScopeType, preferredContext.themeScopeId);
    }
  }, [query.data, setUser, setAvailableContexts, setActiveContext, replacePermissions, loadTheme]);

  useEffect(() => {
    if (!query.error) return;
    if (query.error instanceof ApiClientError && query.error.status === 401) {
      clearSession();
      queryClient.removeQueries({ queryKey: meQueryKey });
    }
  }, [query.error, clearSession]);

  return query;
}
