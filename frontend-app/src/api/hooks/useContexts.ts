import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { toContexts, toIdentityResponse } from '@/api/hooks/identityMapper';
import { useAuthStore } from '@/stores/authStore';
import { useContextStore } from '@/stores/contextStore';
import type { AppContext } from '@/types/auth';

const contextsQueryKey = ['identity', 'contexts'] as const;

async function fetchContexts(): Promise<AppContext[]> {
  try {
    const response = await apiClient.get<unknown>(endpoints.identity.contexts);
    const payload = response && typeof response === 'object' ? (response as Record<string, unknown>) : {};

    if (Array.isArray(payload.contexts)) {
      return toContexts({ availableContexts: payload.contexts });
    }

    return toContexts(payload);
  } catch {
    const fallback = await apiClient.get<unknown>(endpoints.identity.me);
    return toIdentityResponse(fallback).availableContexts;
  }
}

export function useContexts() {
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const availableContexts = useContextStore((state) => state.availableContexts);
  const activeContext = useContextStore((state) => state.activeContext);
  const setAvailableContexts = useContextStore((state) => state.setAvailableContexts);

  const query = useQuery({
    queryKey: contextsQueryKey,
    queryFn: fetchContexts,
    enabled: initialized && isAuthenticated,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!query.data || !query.data.length) return;
    setAvailableContexts(query.data);
  }, [query.data, setAvailableContexts]);

  return {
    availableContexts,
    activeContext,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
