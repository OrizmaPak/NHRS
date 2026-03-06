const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTheme } = require('../src/theme-resolver');

test('resolveTheme merges platform -> parent -> tenant', () => {
  const platformTheme = {
    id: 'platform-1',
    scope_type: 'platform',
    scope_id: null,
    version: 1,
    theme_tokens: {
      colors: { primary: '#0066cc', background: '#ffffff', text: '#111111' },
      typography: { fontFamily: 'Inter', baseFontSize: 16 },
    },
    accessibility_defaults: { fontScaleDefault: 1.0, highContrastDefault: false },
  };
  const parentTheme = {
    id: 'state-1',
    scope_type: 'state',
    scope_id: 'lagos',
    version: 2,
    theme_tokens: {
      colors: { primary: '#009966', accent: '#44bb88' },
      typography: { headingFontFamily: 'Poppins' },
    },
    accessibility_defaults: { reduceMotionDefault: true },
  };
  const tenantTheme = {
    id: 'org-1',
    scope_type: 'organization',
    scope_id: 'org-123',
    version: 3,
    theme_tokens: {
      colors: { secondary: '#ffcc00', text: '#000000' },
      logo: { lightUrl: 'https://cdn/logo-light.png' },
    },
    accessibility_defaults: { dyslexiaFontDefault: true },
  };

  const resolved = resolveTheme({ platformTheme, parentThemes: [parentTheme], tenantTheme });

  assert.equal(resolved.theme_tokens.colors.primary, '#009966');
  assert.equal(resolved.theme_tokens.colors.secondary, '#ffcc00');
  assert.equal(resolved.theme_tokens.colors.text, '#000000');
  assert.equal(resolved.theme_tokens.typography.fontFamily, 'Inter');
  assert.equal(resolved.theme_tokens.typography.headingFontFamily, 'Poppins');
  assert.equal(resolved.accessibility_defaults.reduceMotionDefault, true);
  assert.equal(resolved.accessibility_defaults.dyslexiaFontDefault, true);
  assert.equal(resolved.version, 3);
  assert.equal(resolved.sources.length, 3);
});
