import { useEffect, type PropsWithChildren } from 'react';
import { applyThemeVariables } from '@/lib/theme';
import { useAccessibilityStore } from '@/stores/accessibilityStore';
import { useThemeStore } from '@/stores/themeStore';
import type { EffectiveTheme } from '@/types/theme';

function withDarkMode(theme: EffectiveTheme, enabled: boolean): EffectiveTheme {
  if (!enabled) return theme;

  return {
    ...theme,
    tokens: {
      ...theme.tokens,
      colors: {
        ...theme.tokens.colors,
        background: '#0B1220',
        surface: '#121C2E',
        text: '#E6ECF8',
        muted: '#A3B3D1',
        border: '#243550',
      },
    },
  };
}

function withHighContrast(theme: EffectiveTheme, enabled: boolean): EffectiveTheme {
  if (!enabled) return theme;
  return {
    ...theme,
    tokens: {
      ...theme.tokens,
      colors: {
        ...theme.tokens.colors,
        text: '#F8FAFF',
        muted: '#D9E1F2',
        border: '#5B6E97',
      },
    },
  };
}

function withReadableFont(theme: EffectiveTheme, enabled: boolean): EffectiveTheme {
  if (!enabled) return theme;
  return {
    ...theme,
    tokens: {
      ...theme.tokens,
      typography: {
        ...theme.tokens.typography,
        fontFamily: 'Arial, Tahoma, Verdana, sans-serif',
      },
    },
  };
}

function withAccessibility(theme: EffectiveTheme): EffectiveTheme {
  const state = useAccessibilityStore.getState();
  const withReadable = withReadableFont(theme, state.readableFont);
  const withMode = withDarkMode(withReadable, state.darkMode);
  return withHighContrast(withMode, state.highContrast);
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const darkMode = useAccessibilityStore((state) => state.darkMode);
  const highContrast = useAccessibilityStore((state) => state.highContrast);
  const readableFont = useAccessibilityStore((state) => state.readableFont);
  const fontScale = useAccessibilityStore((state) => state.fontScale);
  const reduceMotion = useAccessibilityStore((state) => state.reduceMotion);
  const applyThemeDefaults = useAccessibilityStore((state) => state.applyThemeDefaults);

  useEffect(() => {
    applyThemeDefaults(resolvedTheme.accessibility);
  }, [resolvedTheme.accessibility, applyThemeDefaults]);

  useEffect(() => {
    const nextTheme = withAccessibility(resolvedTheme);
    applyThemeVariables(nextTheme);
  }, [resolvedTheme, darkMode, highContrast, readableFont]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(fontScale));
    root.dataset.motion = reduceMotion ? 'reduce' : 'normal';
  }, [fontScale, reduceMotion]);

  return <>{children}</>;
}
