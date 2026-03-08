import { useEffect } from 'react';
import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { toast, Toaster } from 'sonner';
import { queryClient } from '@/app/providers/queryClient';
import { useAccessibilityStore } from '@/stores/accessibilityStore';
import { useAuthStore } from '@/stores/authStore';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

export function AppProviders({ children }: PropsWithChildren) {
  const enableQueryDevtools =
    import.meta.env.DEV && import.meta.env.VITE_ENABLE_QUERY_DEVTOOLS === 'true';
  const hydrateAccessibility = useAccessibilityStore((state) => state.hydrate);

  useEffect(() => {
    hydrateAccessibility();
  }, [hydrateAccessibility]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ status?: number; forceLogout?: boolean }>;

      if (custom.detail?.status === 401 && custom.detail?.forceLogout) {
        useAuthStore.getState().clearSession();
        toast.error('Session expired. Please sign in again.');
        return;
      }

      if (custom.detail?.status === 401) {
        toast.error('Authentication is required for this action.');
      }

      if (custom.detail?.status === 403) {
        toast.error('Access denied for this action.');
      }

      if (custom.detail?.status === 429) {
        toast.error('Rate limit reached. Please try again shortly.');
      }

      if (custom.detail?.status === 503) {
        toast.error('Service temporarily unavailable. Please retry in a moment.');
      }

      if ((custom.detail?.status ?? 0) >= 500 && custom.detail?.status !== 503) {
        toast.error('A server error occurred. Please retry.');
      }
    };

    window.addEventListener('nhrs:api-error', handler);
    return () => window.removeEventListener('nhrs:api-error', handler);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </ThemeProvider>
      {enableQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
