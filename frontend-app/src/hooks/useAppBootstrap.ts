import { useEffect } from 'react';
import { useMe } from '@/api/hooks/useMe';
import { useAuthStore } from '@/stores/authStore';

export function useAppBootstrap() {
  const hydrateSession = useAuthStore((state) => state.hydrateSession);
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    hydrateSession();
  }, [hydrateSession]);

  const meQuery = useMe(initialized && isAuthenticated);

  return {
    initialized,
    identityLoading: meQuery.isLoading,
    identityError: meQuery.error,
  };
}
