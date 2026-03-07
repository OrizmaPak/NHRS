import { describe, expect, it } from 'vitest';
import { resolveTheme } from '@/lib/theme';

describe('resolveTheme', () => {
  it('merges platform, parent, and tenant theme tokens', () => {
    const theme = resolveTheme({
      platformTheme: {
        id: 'platform',
        scopeType: 'platform',
        scopeId: null,
        parentThemeId: null,
        themeTokens: { colors: { primary: '#0000FF' } },
        accessibilityDefaults: {},
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      parentTheme: {
        id: 'state',
        scopeType: 'state',
        scopeId: 'state-1',
        parentThemeId: 'platform',
        themeTokens: { colors: { secondary: '#00AA00' } },
        accessibilityDefaults: {},
        version: 1,
        updatedAt: new Date().toISOString(),
      },
      tenantTheme: {
        id: 'org',
        scopeType: 'organization',
        scopeId: 'org-1',
        parentThemeId: 'state',
        themeTokens: { colors: { accent: '#FF5500' } },
        accessibilityDefaults: { fontScaleDefault: 1.1 },
        version: 3,
        updatedAt: new Date().toISOString(),
      },
    });

    expect(theme.tokens.colors.primary).toBe('#0000FF');
    expect(theme.tokens.colors.secondary).toBe('#00AA00');
    expect(theme.tokens.colors.accent).toBe('#FF5500');
    expect(theme.accessibility.fontScaleDefault).toBe(1.1);
    expect(theme.version).toBe(3);
  });
});
