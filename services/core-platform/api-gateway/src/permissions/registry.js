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
  { method: 'POST', path: '/orgs', permissionKey: 'org.create' },
  { method: 'GET', path: '/orgs', permissionKey: 'org.list' },
  { method: 'GET', path: '/orgs/search', permissionKey: 'org.search' },
  { method: 'GET', path: '/orgs/:orgId', permissionKey: 'org.read', orgFrom: 'params.orgId' },
  { method: 'PATCH', path: '/orgs/:orgId', permissionKey: 'org.update', orgFrom: 'params.orgId' },
  { method: 'PATCH', path: '/orgs/:orgId/owner', permissionKey: 'org.owner.assign', orgFrom: 'params.orgId' },
  { method: 'POST', path: '/orgs/:orgId/assign-owner', permissionKey: 'org.owner.assign', orgFrom: 'params.orgId' },
  { method: 'POST', path: '/orgs/:orgId/branches', permissionKey: 'org.branch.create', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/orgs/:orgId/branches', permissionKey: 'org.branch.read', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/orgs/:orgId/branches/:branchId', permissionKey: 'org.branch.read', orgFrom: 'params.orgId' },
  { method: 'PATCH', path: '/orgs/:orgId/branches/:branchId', permissionKey: 'org.branch.update', orgFrom: 'params.orgId' },
  { method: 'DELETE', path: '/orgs/:orgId/branches/:branchId', permissionKey: 'org.branch.delete', orgFrom: 'params.orgId' },
  { method: 'POST', path: '/orgs/:orgId/members', permissionKey: 'org.member.add', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/orgs/:orgId/members', permissionKey: 'org.member.read', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/orgs/:orgId/members/:memberId', permissionKey: 'org.member.read', orgFrom: 'params.orgId' },
  { method: 'PATCH', path: '/orgs/:orgId/members/:memberId', permissionKey: 'org.member.update', orgFrom: 'params.orgId' },
  { method: 'PATCH', path: '/orgs/:orgId/members/:memberId/status', permissionKey: 'org.member.status.update', orgFrom: 'params.orgId' },
  { method: 'POST', path: '/orgs/:orgId/members/:memberId/branches', permissionKey: 'org.member.branch.assign', orgFrom: 'params.orgId' },
  { method: 'PATCH', path: '/orgs/:orgId/members/:memberId/branches/:assignmentId', permissionKey: 'org.member.branch.update', orgFrom: 'params.orgId' },
  { method: 'DELETE', path: '/orgs/:orgId/members/:memberId/branches/:assignmentId', permissionKey: 'org.member.branch.remove', orgFrom: 'params.orgId' },
  { method: 'POST', path: '/orgs/:orgId/members/:memberId/transfer', permissionKey: 'org.member.transfer', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/orgs/:orgId/members/:memberId/history', permissionKey: 'org.member.history.read', orgFrom: 'params.orgId' },
  { method: 'POST', path: '/orgs/:orgId/memberships/invite', permissionKey: 'org.member.invite', orgFrom: 'params.orgId' },
  { method: 'POST', path: '/orgs/:orgId/memberships/:membershipId/branches', permissionKey: 'org.branch.assign', orgFrom: 'params.orgId' },
  { method: 'PATCH', path: '/orgs/:orgId/memberships/:membershipId/branches/:branchId', permissionKey: 'org.branch.assignment.update', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/orgs/:orgId/memberships', permissionKey: 'org.member.list', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/orgs/:orgId/memberships/:membershipId', permissionKey: 'org.member.read', orgFrom: 'params.orgId' },
  { method: 'GET', path: '/users/:userId/memberships', permissionKey: 'membership.user.read' },
  { method: 'GET', path: '/users/:userId/movement-history', permissionKey: 'membership.user.history.read' },
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
