import { create } from 'zustand';
import { ACCESSIBILITY_STORAGE_KEY } from '@/lib/constants';

type AccessibilityState = {
  darkMode: boolean;
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
  readableFont: boolean;
  setFontScale: (value: number) => void;
  toggleDarkMode: (value?: boolean) => void;
  toggleHighContrast: (value?: boolean) => void;
  toggleReduceMotion: (value?: boolean) => void;
  toggleReadableFont: (value?: boolean) => void;
  applyThemeDefaults: (defaults: {
    highContrastDefault?: boolean;
    reduceMotionDefault?: boolean;
    dyslexiaFontDefault?: boolean;
    fontScaleDefault?: number;
    darkModeDefault?: boolean;
  }) => void;
  applyToDocument: () => void;
  hydrate: () => void;
};

type PersistedAccessibility = Pick<
  AccessibilityState,
  'darkMode' | 'fontScale' | 'highContrast' | 'reduceMotion' | 'readableFont'
>;

const defaults: PersistedAccessibility = {
  darkMode: false,
  fontScale: 1,
  highContrast: false,
  reduceMotion: false,
  readableFont: false,
};

function persist(settings: PersistedAccessibility): void {
  localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(settings));
}

function clampFontScale(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.min(1.3, Math.max(0.9, Number(value.toFixed(2))));
}

export const useAccessibilityStore = create<AccessibilityState>((set, get) => ({
  ...defaults,

  setFontScale: (value) => {
    const fontScale = clampFontScale(value);
    set({ fontScale });
    persist({
      darkMode: get().darkMode,
      fontScale,
      highContrast: get().highContrast,
      reduceMotion: get().reduceMotion,
      readableFont: get().readableFont,
    });
    get().applyToDocument();
  },

  toggleDarkMode: (value) => {
    const darkMode = typeof value === 'boolean' ? value : !get().darkMode;
    set({ darkMode });
    persist({
      darkMode,
      fontScale: get().fontScale,
      highContrast: get().highContrast,
      reduceMotion: get().reduceMotion,
      readableFont: get().readableFont,
    });
    get().applyToDocument();
  },

  toggleHighContrast: (value) => {
    const highContrast = typeof value === 'boolean' ? value : !get().highContrast;
    set({ highContrast });
    persist({
      darkMode: get().darkMode,
      fontScale: get().fontScale,
      highContrast,
      reduceMotion: get().reduceMotion,
      readableFont: get().readableFont,
    });
    get().applyToDocument();
  },

  toggleReduceMotion: (value) => {
    const reduceMotion = typeof value === 'boolean' ? value : !get().reduceMotion;
    set({ reduceMotion });
    persist({
      darkMode: get().darkMode,
      fontScale: get().fontScale,
      highContrast: get().highContrast,
      reduceMotion,
      readableFont: get().readableFont,
    });
    get().applyToDocument();
  },

  toggleReadableFont: (value) => {
    const readableFont = typeof value === 'boolean' ? value : !get().readableFont;
    set({ readableFont });
    persist({
      darkMode: get().darkMode,
      fontScale: get().fontScale,
      highContrast: get().highContrast,
      reduceMotion: get().reduceMotion,
      readableFont,
    });
    get().applyToDocument();
  },

  applyThemeDefaults: (defaultsFromTheme) => {
    const hasStored = Boolean(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY));
    if (hasStored) return;
    const current = get();
    const next = {
      darkMode: typeof defaultsFromTheme.darkModeDefault === 'boolean' ? defaultsFromTheme.darkModeDefault : current.darkMode,
      fontScale: clampFontScale(defaultsFromTheme.fontScaleDefault ?? current.fontScale),
      highContrast:
        typeof defaultsFromTheme.highContrastDefault === 'boolean'
          ? defaultsFromTheme.highContrastDefault
          : current.highContrast,
      reduceMotion:
        typeof defaultsFromTheme.reduceMotionDefault === 'boolean'
          ? defaultsFromTheme.reduceMotionDefault
          : current.reduceMotion,
      readableFont:
        typeof defaultsFromTheme.dyslexiaFontDefault === 'boolean'
          ? defaultsFromTheme.dyslexiaFontDefault
          : current.readableFont,
    };
    const unchanged =
      current.darkMode === next.darkMode &&
      current.fontScale === next.fontScale &&
      current.highContrast === next.highContrast &&
      current.reduceMotion === next.reduceMotion &&
      current.readableFont === next.readableFont;
    if (!unchanged) {
      set(next);
    }
    get().applyToDocument();
  },

  applyToDocument: () => {
    const root = document.documentElement;
    const state = get();
    root.dataset.contrast = state.highContrast ? 'high' : 'normal';
    root.dataset.motion = state.reduceMotion ? 'reduce' : 'normal';
    root.dataset.readableFont = state.readableFont ? 'enabled' : 'disabled';
    root.dataset.theme = state.darkMode ? 'dark' : 'light';
    root.style.setProperty('--font-scale', String(state.fontScale));
  },

  hydrate: () => {
    const stored = localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<PersistedAccessibility>;
        set({
          darkMode: typeof parsed.darkMode === 'boolean' ? parsed.darkMode : defaults.darkMode,
          fontScale: clampFontScale(parsed.fontScale ?? defaults.fontScale),
          highContrast: typeof parsed.highContrast === 'boolean' ? parsed.highContrast : defaults.highContrast,
          reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : defaults.reduceMotion,
          readableFont: typeof parsed.readableFont === 'boolean' ? parsed.readableFont : defaults.readableFont,
        });
      } catch {
        set(defaults);
      }
    }
    get().applyToDocument();
  },
}));
