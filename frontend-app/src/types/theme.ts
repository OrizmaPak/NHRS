export type ScopeType = 'platform' | 'organization' | 'state' | 'taskforce';

export type ThemeTokens = {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
    success: string;
    warning: string;
    danger: string;
  };
  typography: {
    fontFamily: string;
    headingFontFamily: string;
    baseFontSize: number;
    lineHeight: number;
  };
  radius: {
    sm: string;
    md: string;
    lg: string;
  };
  elevation: {
    sm: string;
    md: string;
    lg: string;
  };
  logo: {
    lightUrl: string;
    darkUrl: string;
    markUrl: string;
  };
  ui?: {
    sidebarStyle?: 'glass' | 'solid' | 'minimal';
    topbarStyle?: 'solid' | 'blur';
  };
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type AccessibilityDefaults = {
  highContrastDefault: boolean;
  reduceMotionDefault: boolean;
  dyslexiaFontDefault: boolean;
  fontScaleDefault: number;
  darkModeDefault?: boolean;
};

export type ThemeConfig = {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null;
  parentThemeId: string | null;
  themeTokens: DeepPartial<ThemeTokens>;
  accessibilityDefaults: DeepPartial<AccessibilityDefaults>;
  version: number;
  updatedAt: string;
};

export type EffectiveTheme = {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null;
  version: number;
  tokens: ThemeTokens;
  accessibility: AccessibilityDefaults;
};
