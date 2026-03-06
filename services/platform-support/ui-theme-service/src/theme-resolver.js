function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const result = isObject(base) ? { ...base } : {};
  if (!isObject(override)) {
    return result;
  }
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normalizeTheme(theme) {
  if (!theme || typeof theme !== 'object') return null;
  return {
    id: theme.id,
    scope_type: theme.scope_type,
    scope_id: theme.scope_id ?? null,
    parent_theme_id: theme.parent_theme_id || null,
    theme_tokens: theme.theme_tokens || {},
    accessibility_defaults: theme.accessibility_defaults || {},
    version: Number(theme.version || 1),
    updatedAt: theme.updatedAt || null,
  };
}

function resolveTheme({ platformTheme, parentThemes = [], tenantTheme }) {
  const sources = [];
  let mergedTokens = {};
  let mergedAccessibility = {};

  const ordered = [platformTheme, ...parentThemes, tenantTheme]
    .map(normalizeTheme)
    .filter(Boolean);

  for (const source of ordered) {
    mergedTokens = deepMerge(mergedTokens, source.theme_tokens || {});
    mergedAccessibility = deepMerge(mergedAccessibility, source.accessibility_defaults || {});
    sources.push({
      id: source.id,
      scope_type: source.scope_type,
      scope_id: source.scope_id,
      version: source.version,
    });
  }

  const version = ordered.reduce((max, item) => Math.max(max, Number(item.version || 1)), 1);

  return {
    theme_tokens: mergedTokens,
    accessibility_defaults: mergedAccessibility,
    version,
    sources,
  };
}

module.exports = {
  deepMerge,
  resolveTheme,
};
