import { create } from 'zustand';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { applyThemeVariables, resolveTheme } from '@/lib/theme';
import type { EffectiveTheme, ScopeType, ThemeConfig, ThemeTokens, AccessibilityDefaults } from '@/types/theme';

type ThemeState = {
  activeTheme: EffectiveTheme;
  platformTheme: ThemeConfig | null;
  contextTheme: ThemeConfig | null;
  resolvedTheme: EffectiveTheme;
  loading: boolean;
  theme: EffectiveTheme;
  setTheme: (theme: EffectiveTheme) => void;
  loadPlatformTheme: () => Promise<ThemeConfig | null>;
  loadContextTheme: (scopeType: ScopeType, scopeId: string | null) => Promise<ThemeConfig | null>;
  resolveTheme: (platformTheme?: ThemeConfig | null, contextTheme?: ThemeConfig | null) => EffectiveTheme;
  applyTheme: (theme: EffectiveTheme) => void;
  loadTheme: (scopeType: ScopeType, scopeId: string | null) => Promise<EffectiveTheme>;
  resetTheme: () => void;
  reset: () => void;
};

const initialTheme = resolveTheme({});

function asThemeConfig(payload: unknown): ThemeConfig | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const candidate =
    source.data && typeof source.data === 'object'
      ? (source.data as Record<string, unknown>)
      : source;

  if (!candidate.id || !candidate.themeTokens) return null;

  return {
    id: String(candidate.id),
    scopeType: String(candidate.scopeType ?? 'platform') as ScopeType,
    scopeId: candidate.scopeId ? String(candidate.scopeId) : null,
    parentThemeId: candidate.parentThemeId ? String(candidate.parentThemeId) : null,
    themeTokens: candidate.themeTokens as ThemeConfig['themeTokens'],
    accessibilityDefaults: (candidate.accessibilityDefaults ?? {}) as ThemeConfig['accessibilityDefaults'],
    version: Number(candidate.version ?? 1),
    updatedAt: String(candidate.updatedAt ?? new Date().toISOString()),
  };
}

function asEffectiveTheme(payload: unknown): EffectiveTheme | null {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const candidate =
    source.data && typeof source.data === 'object'
      ? (source.data as Record<string, unknown>)
      : source;

  const tokens =
    (candidate.tokens as ThemeTokens | undefined) ??
    (candidate.themeTokens as ThemeTokens | undefined) ??
    (candidate.theme_tokens as ThemeTokens | undefined);

  if (!tokens) return null;

  return {
    id: String(candidate.id ?? 'theme-effective'),
    scopeType: String(candidate.scopeType ?? candidate.scope_type ?? 'platform') as ScopeType,
    scopeId: candidate.scopeId ? String(candidate.scopeId) : candidate.scope_id ? String(candidate.scope_id) : null,
    version: Number(candidate.version ?? 1),
    tokens,
    accessibility:
      ((candidate.accessibility as AccessibilityDefaults | undefined) ??
        (candidate.accessibilityDefaults as AccessibilityDefaults | undefined) ??
        {
          highContrastDefault: false,
          reduceMotionDefault: false,
          dyslexiaFontDefault: false,
          fontScaleDefault: 1,
          darkModeDefault: false,
        }),
  };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  activeTheme: initialTheme,
  platformTheme: null,
  contextTheme: null,
  resolvedTheme: initialTheme,
  loading: false,
  theme: initialTheme,

  setTheme: (theme) => {
    applyThemeVariables(theme);
    set({
      activeTheme: theme,
      resolvedTheme: theme,
      theme,
    });
  },

  loadPlatformTheme: async () => {
    try {
      const response = await apiClient.get<unknown>(endpoints.uiTheme.platform);
      const platformTheme = asThemeConfig(response);
      set({ platformTheme });
      return platformTheme;
    } catch {
      set({ platformTheme: null });
      return null;
    }
  },

  loadContextTheme: async (scopeType, scopeId) => {
    if (!scopeId && scopeType !== 'platform') {
      set({ contextTheme: null });
      return null;
    }

    try {
      const response = await apiClient.get<unknown>(endpoints.uiTheme.list, {
        query: { scope_type: scopeType, scope_id: scopeId },
      });

      if (Array.isArray(response)) {
        const first = asThemeConfig(response[0]);
        set({ contextTheme: first });
        return first;
      }

      const source = response as Record<string, unknown>;
      if (Array.isArray(source.items)) {
        const first = asThemeConfig(source.items[0]);
        set({ contextTheme: first });
        return first;
      }

      const fallback = asThemeConfig(response);
      set({ contextTheme: fallback });
      return fallback;
    } catch {
      set({ contextTheme: null });
      return null;
    }
  },

  resolveTheme: (platformTheme, contextTheme) => {
    const resolved = resolveTheme({
      platformTheme: platformTheme ?? get().platformTheme ?? undefined,
      tenantTheme: contextTheme ?? get().contextTheme ?? undefined,
    });
    set({ resolvedTheme: resolved, activeTheme: resolved, theme: resolved });
    return resolved;
  },

  applyTheme: (theme) => {
    applyThemeVariables(theme);
    set({ activeTheme: theme, resolvedTheme: theme, theme });
  },

  loadTheme: async (scopeType, scopeId) => {
    set({ loading: true });
    try {
      const effectiveResponse = await apiClient.get<unknown>(endpoints.uiTheme.effective, {
        query: { scope_type: scopeType, scope_id: scopeId },
      });
      const effectiveTheme = asEffectiveTheme(effectiveResponse);
      if (effectiveTheme) {
        // Keep context theme metadata for editor/save endpoints while using backend-resolved effective tokens.
        void get().loadContextTheme(scopeType, scopeId);
        set({ loading: false, resolvedTheme: effectiveTheme, activeTheme: effectiveTheme, theme: effectiveTheme });
        get().applyTheme(effectiveTheme);
        return effectiveTheme;
      }
    } catch {
      // Fallback to frontend resolution when effective endpoint is unavailable.
    }

    try {
      const [platformTheme, contextTheme] = await Promise.all([
        get().loadPlatformTheme(),
        get().loadContextTheme(scopeType, scopeId),
      ]);
      const resolved = get().resolveTheme(platformTheme, contextTheme);
      get().applyTheme(resolved);
      set({ loading: false });
      return resolved;
    } catch {
      applyThemeVariables(initialTheme);
      set({
        activeTheme: initialTheme,
        platformTheme: null,
        contextTheme: null,
        resolvedTheme: initialTheme,
        theme: initialTheme,
        loading: false,
      });
      return initialTheme;
    }
  },

  resetTheme: () => {
    applyThemeVariables(initialTheme);
    set({
      activeTheme: initialTheme,
      platformTheme: null,
      contextTheme: null,
      resolvedTheme: initialTheme,
      theme: initialTheme,
      loading: false,
    });
  },

  reset: () => {
    get().resetTheme();
  },
}));
