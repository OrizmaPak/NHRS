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
  const setRoles = usePermissionsStore((state) => state.setRoles);
  const setOverrides = usePermissionsStore((state) => state.setOverrides);
  const setEffectivePermissions = usePermissionsStore((state) => state.setEffectivePermissions);
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
    setRoles(query.data.roles ?? []);
    const sourcePermissions = preferredContext
      ? (Array.isArray(preferredContext.permissions) ? preferredContext.permissions : [])
      : query.data.permissions;
    replacePermissions(sourcePermissions);

    const raw = query.data as unknown as {
      overrides?: Record<string, 'allow' | 'deny'>;
      effectivePermissions?: Array<{ key: string; source: 'role' | 'override_allow' | 'override_deny'; granted: boolean }>;
    };
    if (raw.overrides) {
      setOverrides(raw.overrides);
    }
    if (Array.isArray(raw.effectivePermissions) && raw.effectivePermissions.length > 0) {
      setEffectivePermissions(raw.effectivePermissions);
    }

    if (preferredContext) {
      void loadTheme(preferredContext.themeScopeType, preferredContext.themeScopeId);
    }
  }, [query.data, setUser, setAvailableContexts, setActiveContext, setRoles, replacePermissions, setOverrides, setEffectivePermissions, loadTheme]);

  useEffect(() => {
    if (!query.error) return;
    if (query.error instanceof ApiClientError && query.error.status === 401) {
      clearSession();
      queryClient.removeQueries({ queryKey: meQueryKey });
    }
  }, [query.error, clearSession]);

  return query;
}
