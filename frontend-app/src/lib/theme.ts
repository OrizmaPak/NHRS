import nhrsLogoLight from '@/assets/logos/nhrs-logo-light.svg';
import nhrsLogoDark from '@/assets/logos/nhrs-logo-dark.svg';
import nhrsMark from '@/assets/logos/nhrs-mark.svg';
import type { AccessibilityDefaults, EffectiveTheme, ThemeConfig, ThemeTokens } from '@/types/theme';

export const defaultThemeTokens: ThemeTokens = {
  colors: {
    primary: '#0B57D0',
    secondary: '#0F766E',
    accent: '#D97706',
    background: '#F5F8FC',
    surface: '#FFFFFF',
    text: '#0B1220',
    muted: '#667085',
    border: '#D0D7E2',
    success: '#059669',
    warning: '#D97706',
    danger: '#DC2626',
  },
  typography: {
    fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
    headingFontFamily: 'Sora, Plus Jakarta Sans, system-ui, sans-serif',
    baseFontSize: 16,
    lineHeight: 1.5,
  },
  radius: {
    sm: '10px',
    md: '14px',
    lg: '18px',
  },
  elevation: {
    sm: '0 4px 12px -6px color-mix(in srgb, #0f172a 30%, transparent)',
    md: '0 12px 28px -14px color-mix(in srgb, #0f172a 45%, transparent)',
    lg: '0 20px 40px -18px color-mix(in srgb, #0f172a 55%, transparent)',
  },
  logo: {
    lightUrl: nhrsLogoLight,
    darkUrl: nhrsLogoDark,
    markUrl: nhrsMark,
  },
  ui: {
    sidebarStyle: 'glass',
    topbarStyle: 'blur',
  },
};

export const defaultAccessibility: AccessibilityDefaults = {
  highContrastDefault: false,
  reduceMotionDefault: false,
  dyslexiaFontDefault: false,
  fontScaleDefault: 1,
  darkModeDefault: false,
};

function deepMerge<T extends object>(base: T, override?: Partial<T>): T {
  if (!override) return base;
  const output = { ...base } as Record<string, unknown>;

  Object.entries(override).forEach(([key, value]) => {
    if (value === undefined) return;

    if (Array.isArray(value)) {
      output[key] = value;
      return;
    }

    if (value && typeof value === 'object') {
      output[key] = deepMerge((output[key] as object) ?? {}, value as object);
      return;
    }

    output[key] = value;
  });

  return output as T;
}

export function resolveTheme(params: {
  platformTheme?: ThemeConfig;
  parentTheme?: ThemeConfig;
  tenantTheme?: ThemeConfig;
}): EffectiveTheme {
  const { platformTheme, parentTheme, tenantTheme } = params;

  const tokens = deepMerge(
    deepMerge(
      deepMerge(defaultThemeTokens, platformTheme?.themeTokens as Partial<ThemeTokens>),
      parentTheme?.themeTokens as Partial<ThemeTokens>,
    ),
    tenantTheme?.themeTokens as Partial<ThemeTokens>,
  );

  const accessibility = deepMerge(
    deepMerge(
      deepMerge(defaultAccessibility, platformTheme?.accessibilityDefaults as Partial<AccessibilityDefaults>),
      parentTheme?.accessibilityDefaults as Partial<AccessibilityDefaults>,
    ),
    tenantTheme?.accessibilityDefaults as Partial<AccessibilityDefaults>,
  );

  const target = tenantTheme ?? parentTheme ?? platformTheme;

  return {
    id: target?.id ?? 'theme-platform-default',
    scopeType: target?.scopeType ?? 'platform',
    scopeId: target?.scopeId ?? null,
    version: target?.version ?? 1,
    tokens,
    accessibility,
  };
}

export function applyThemeVariables(theme: EffectiveTheme): void {
  const root = document.documentElement;
  const colors = theme.tokens.colors;

  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-secondary', colors.secondary);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-background', colors.background);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-muted', colors.muted);
  root.style.setProperty('--color-border', colors.border);
  root.style.setProperty('--color-success', colors.success);
  root.style.setProperty('--color-warning', colors.warning);
  root.style.setProperty('--color-danger', colors.danger);

  root.style.setProperty('--font-family', theme.tokens.typography.fontFamily);
  root.style.setProperty('--font-family-base', theme.tokens.typography.fontFamily);
  root.style.setProperty('--font-family-display', theme.tokens.typography.headingFontFamily);
  root.style.setProperty('--font-family-heading', theme.tokens.typography.headingFontFamily);
  root.style.setProperty('--font-size-base', `${theme.tokens.typography.baseFontSize}px`);
  root.style.setProperty('--line-height-base', `${theme.tokens.typography.lineHeight}`);
  root.style.setProperty('--radius-sm', theme.tokens.radius.sm);
  root.style.setProperty('--radius-md', theme.tokens.radius.md);
  root.style.setProperty('--radius-lg', theme.tokens.radius.lg);
  root.style.setProperty('--shadow-sm', theme.tokens.elevation.sm);
  root.style.setProperty('--shadow-md', theme.tokens.elevation.md);
  root.style.setProperty('--shadow-lg', theme.tokens.elevation.lg);
}

export function getThemeLogo(theme: EffectiveTheme, preferDark: boolean): string {
  if (preferDark && theme.tokens.logo.darkUrl) return theme.tokens.logo.darkUrl;
  if (!preferDark && theme.tokens.logo.lightUrl) return theme.tokens.logo.lightUrl;
  return preferDark ? defaultThemeTokens.logo.darkUrl : defaultThemeTokens.logo.lightUrl;
}
