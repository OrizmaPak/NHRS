import { create } from 'zustand';
import { queryClient } from '@/app/providers/queryClient';
import { apiClient, ApiClientError } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import {
  clearSessionTokens,
  getRefreshToken,
  hasRefreshToken,
  setSessionTokens,
} from '@/lib/sessionStorage';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useThemeStore } from '@/stores/themeStore';
import type { LoginPayload, LoginResponse, RefreshResponse, UserProfile } from '@/types/auth';

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  isAuthenticated: boolean;
  hydrateSession: () => void;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  setSession: (session: { accessToken: string; refreshToken: string; user?: UserProfile | null }) => void;
  clearSession: () => void;
  setUser: (user: UserProfile | null) => void;
  refreshSession: () => Promise<boolean>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  loading: false,
  initialized: false,
  error: null,
  isAuthenticated: false,

  hydrateSession: () => {
    const refreshToken = getRefreshToken();
    if (!hasRefreshToken() || !refreshToken) {
      set({ initialized: true, isAuthenticated: false, accessToken: null, refreshToken: null });
      return;
    }

    set({
      initialized: true,
      isAuthenticated: true,
      accessToken: null,
      refreshToken,
    });
  },

  setSession: ({ accessToken, refreshToken, user }) => {
    setSessionTokens({ accessToken, refreshToken });
    set({
      accessToken,
      refreshToken,
      user: user ?? get().user,
      isAuthenticated: true,
      error: null,
      initialized: true,
    });
  },

  clearSession: () => {
    clearSessionTokens();
    useContextStore.getState().reset();
    usePermissionsStore.getState().clear();
    useThemeStore.getState().reset();
    queryClient.clear();
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      loading: false,
      error: null,
      initialized: true,
    });
  },

  setUser: (user) => set({ user }),

  login: async (payload) => {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.post<LoginResponse>(endpoints.auth.login, payload, { skipAuth: true });
      if (!response.accessToken || !response.refreshToken) {
        throw new ApiClientError('Invalid login response', 500, 'INVALID_LOGIN_RESPONSE');
      }

      get().setSession({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        user: response.user
          ? {
              ...response.user,
              requiresPasswordChange:
                response.user.requiresPasswordChange ?? Boolean(response.requiresPasswordChange),
            }
          : null,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Login failed' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  refreshSession: async () => {
    const refreshToken = get().refreshToken ?? getRefreshToken();
    if (!refreshToken) {
      get().clearSession();
      return false;
    }

    try {
      const response = await apiClient.post<RefreshResponse>(
        endpoints.auth.refresh,
        { refreshToken },
        { skipAuth: true, skipRefresh: true },
      );

      if (!response.accessToken) {
        get().clearSession();
        return false;
      }

      get().setSession({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken ?? refreshToken,
      });

      return true;
    } catch {
      get().clearSession();
      return false;
    }
  },

  logout: async () => {
    try {
      if (get().isAuthenticated) {
        const refreshToken = get().refreshToken ?? getRefreshToken();
        await apiClient.post(endpoints.auth.logout, { refreshToken });
      }
    } catch {
      // noop: always clear local session
    } finally {
      get().clearSession();
    }
  },
}));
