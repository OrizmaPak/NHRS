const permissionRegistry = [
  { method: 'GET', path: '/health', public: true },
  { method: 'GET', path: '/docs', public: true },
  { method: 'GET', path: '/docs/*', public: true },
  { method: 'GET', path: '/openapi.json', public: true },
  { method: 'POST', path: '/auth/login', public: true },
  { method: 'POST', path: '/auth/password/forgot', public: true },
  { method: 'POST', path: '/auth/password/reset', public: true },
  { method: 'POST', path: '/auth/token/refresh', public: true },
  { method: 'POST', path: '/auth/logout', public: true },
  { method: 'POST', path: '/auth/password/set', permissionKey: 'auth.password.change' },
  { method: 'POST', path: '/auth/password/change', permissionKey: 'auth.password.change' },
  { method: 'GET', path: '/auth/me', permissionKey: 'auth.me.read' },
  { method: 'POST', path: '/auth/contact/phone', permissionKey: 'auth.contact.phone.write' },
  { method: 'POST', path: '/auth/contact/phone/verify', permissionKey: 'auth.contact.phone.write' },
  { method: 'POST', path: '/auth/contact/email', permissionKey: 'auth.contact.email.write' },
  { method: 'POST', path: '/auth/contact/email/verify', permissionKey: 'auth.contact.email.write' },
  { method: 'GET', path: '/nin/:nin', permissionKey: 'nin.profile.read' },
  { method: 'POST', path: '/nin/refresh/:nin', permissionKey: 'nin.profile.read' },
  { method: 'GET', path: '/rbac/me/scope', permissionKey: 'auth.me.read' },
  { method: 'POST', path: '/rbac/check', permissionKey: 'auth.me.read' },
  { method: 'POST', path: '/rbac/app/permissions', permissionKey: 'rbac.app.manage' },
  { method: 'GET', path: '/rbac/app/permissions', permissionKey: 'rbac.app.manage' },
  { method: 'POST', path: '/rbac/app/roles', permissionKey: 'rbac.app.manage' },
  { method: 'GET', path: '/rbac/app/roles', permissionKey: 'rbac.app.manage' },
  { method: 'PATCH', path: '/rbac/app/roles/:roleId', permissionKey: 'rbac.app.manage' },
  { method: 'DELETE', path: '/rbac/app/roles/:roleId', permissionKey: 'rbac.app.manage' },
  { method: 'POST', path: '/rbac/app/users/:userId/roles', permissionKey: 'rbac.app.manage' },
  { method: 'POST', path: '/rbac/app/users/:userId/overrides', permissionKey: 'rbac.app.manage' },
  { method: 'GET', path: '/rbac/app/users/:userId/access', permissionKey: 'rbac.app.manage' },
  { method: 'POST', path: '/rbac/org/:organizationId/permissions', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'GET', path: '/rbac/org/:organizationId/permissions', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'POST', path: '/rbac/org/:organizationId/roles', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'GET', path: '/rbac/org/:organizationId/roles', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'PATCH', path: '/rbac/org/:organizationId/roles/:roleId', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'DELETE', path: '/rbac/org/:organizationId/roles/:roleId', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'POST', path: '/rbac/org/:organizationId/users/:userId/roles', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'POST', path: '/rbac/org/:organizationId/users/:userId/overrides', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'GET', path: '/rbac/org/:organizationId/users/:userId/access', permissionKey: 'rbac.org.manage', orgFrom: 'params.organizationId' },
  { method: 'GET', path: '/audit/events', permissionKey: 'audit.read' },
  { method: 'GET', path: '/audit/events/:eventId', permissionKey: 'audit.read' },
  { method: 'GET', path: '/profile/me', permissionKey: 'profile.me.read' },
  { method: 'PATCH', path: '/profile/me', permissionKey: 'profile.me.update' },
  { method: 'POST', path: '/profile/me/request-nin-refresh', permissionKey: 'profile.nin.refresh.request' },
  { method: 'GET', path: '/profile/me/status', permissionKey: 'profile.me.read' },
  { method: 'GET', path: '/profile/search', permissionKey: 'profile.search' },
  { method: 'GET', path: '/profile/:userId', permissionKey: 'profile.user.read' },
  { method: 'GET', path: '/profile/by-nin/:nin', permissionKey: 'profile.user.read' },
  { method: 'POST', path: '/profile/create-placeholder', permissionKey: 'profile.placeholder.create' },
];

function pathMatches(pattern, actualPath) {
  if (pattern.endsWith('/*')) {
    return actualPath.startsWith(pattern.slice(0, -1));
  }
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = actualPath.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return false;
  }
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith(':')) {
      continue;
    }
    if (patternParts[i] !== pathParts[i]) {
      return false;
    }
  }
  return true;
}

function findPermissionRule(method, path) {
  return permissionRegistry.find((r) => r.method === method && pathMatches(r.path, path));
}

module.exports = {
  permissionRegistry,
  findPermissionRule,
};
