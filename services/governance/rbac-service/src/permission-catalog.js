function normalizePermissionRuleList(rules = []) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => {
      if (typeof rule === 'string') {
        const permissionKey = String(rule).trim();
        if (!permissionKey) return null;
        return { permissionKey, effect: 'allow' };
      }
      if (!rule || typeof rule !== 'object') return null;
      const permissionKey = String(rule.permissionKey || rule.key || '').trim();
      if (!permissionKey) return null;
      const normalized = {
        permissionKey,
        effect: String(rule.effect || rule.value || '').trim().toLowerCase() === 'deny' ? 'deny' : 'allow',
      };
      const roleName = String(rule.roleName || rule.role || rule.contextRole || '').trim().toLowerCase();
      if (roleName) {
        normalized.roleName = roleName;
      }
      return normalized;
    })
    .filter(Boolean);
}

function buildScopedPermissionCatalog(systemPermissions = [], customPermissions = [], scope, organizationId = null) {
  const byKey = new Map();

  for (const entry of Array.isArray(systemPermissions) ? systemPermissions : []) {
    if (!entry || entry.scope !== scope || !entry.key) continue;
    byKey.set(String(entry.key), {
      key: String(entry.key),
      name: String(entry.name || entry.key),
      description: String(entry.description || entry.name || entry.key),
      scope,
      module: String(entry.module || 'general'),
      actions: Array.isArray(entry.actions) ? entry.actions : [],
      isSystem: true,
      organizationId,
      createdAt: null,
      updatedAt: null,
    });
  }

  for (const entry of Array.isArray(customPermissions) ? customPermissions : []) {
    const key = String(entry?.key || '').trim();
    if (!key) continue;
    byKey.set(key, {
      ...entry,
      key,
      name: String(entry?.name || key),
      description: String(entry?.description || entry?.name || key),
      scope,
      module: String(entry?.module || 'general'),
      actions: Array.isArray(entry?.actions) ? entry.actions : [],
      isSystem: Boolean(entry?.isSystem),
      organizationId,
    });
  }

  return Array.from(byKey.values()).sort((left, right) => {
    if (Boolean(left.isSystem) !== Boolean(right.isSystem)) {
      return left.isSystem ? -1 : 1;
    }
    const moduleCompare = String(left.module || '').localeCompare(String(right.module || ''));
    if (moduleCompare !== 0) return moduleCompare;
    return String(left.key || '').localeCompare(String(right.key || ''));
  });
}

function filterRulesToAllowedKeys(rules = [], allowedKeys = new Set()) {
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(Array.from(allowedKeys || []));
  return normalizePermissionRuleList(rules).filter((rule) => allowed.has(rule.permissionKey));
}

module.exports = {
  buildScopedPermissionCatalog,
  filterRulesToAllowedKeys,
  normalizePermissionRuleList,
};
