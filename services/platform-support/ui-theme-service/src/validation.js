const allowedColorPattern = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^rgba?\((\s*\d{1,3}\s*,){2}\s*\d{1,3}(\s*,\s*(0|0?\.\d+|1(\.0+)?))?\s*\)$/;
const logoTypeAllowlist = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const colorKeys = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger'];

function parseHex(hex) {
  const clean = hex.slice(1);
  if (clean.length === 3) {
    return clean.split('').map((c) => Number.parseInt(c + c, 16));
  }
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function parseRgb(color) {
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(',').map((p) => p.trim());
  const rgb = parts.slice(0, 3).map((p) => Number.parseInt(p, 10));
  if (rgb.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return rgb;
}

function toRgb(color) {
  if (typeof color !== 'string') return null;
  if (color.startsWith('#')) return parseHex(color);
  if (color.toLowerCase().startsWith('rgb')) return parseRgb(color);
  return null;
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function contrastRatio(colorA, colorB) {
  const a = toRgb(colorA);
  const b = toRgb(colorB);
  if (!a || !b) return null;
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function validateColorInput(colors = {}) {
  const invalid = [];
  for (const key of colorKeys) {
    const value = colors[key];
    if (value == null) continue;
    if (typeof value !== 'string' || !allowedColorPattern.test(value)) {
      invalid.push({ key, value });
    }
  }
  return invalid;
}

function validateContrast(themeTokens = {}) {
  const colors = themeTokens.colors || {};
  const textRatio = contrastRatio(colors.text, colors.background);
  if (textRatio != null && textRatio < 4.5) {
    return { ok: false, reason: 'Insufficient contrast between text and background', ratio: Number(textRatio.toFixed(2)) };
  }
  const primaryRatio = contrastRatio(colors.primary, colors.background);
  if (primaryRatio != null && primaryRatio < 3) {
    return { ok: false, reason: 'Insufficient contrast between primary and background', ratio: Number(primaryRatio.toFixed(2)) };
  }
  return { ok: true };
}

function isSafeSvg(buffer) {
  const value = buffer.toString('utf8').toLowerCase();
  if (value.includes('<script')) return false;
  if (value.includes('onload=')) return false;
  if (value.includes('javascript:')) return false;
  return true;
}

module.exports = {
  logoTypeAllowlist,
  validateColorInput,
  validateContrast,
  isSafeSvg,
};
