export type InterfacePermission = {
  key: string;
  interfaceLabel: string;
  route: string;
  module: string;
  description: string;
};

export type PermissionDisplayMeta = {
  title: string;
  groupLabel: string;
  actionLabel: string;
  helperText: string;
  interfaceSummary: string | null;
  routeSummary: string | null;
  interfaceCount: number;
  rawKey: string;
};

export type PermissionDisplayGroup<T> = {
  label: string;
  items: T[];
};

function makeEntry(
  key: string,
  interfaceLabel: string,
  route: string,
  module: string,
  description: string,
): InterfacePermission {
  return { key, interfaceLabel, route, module, description };
}

export const interfacePermissions: InterfacePermission[] = [
  makeEntry('auth.me.read', 'Dashboard', '/app', 'core', 'Access main dashboard interface'),

  makeEntry('auth.me.read', 'Settings', '/app/settings', 'settings', 'Access settings hub interface'),
  makeEntry('auth.me.read', 'Appearance Settings', '/app/settings/appearance', 'settings', 'Access appearance settings interface'),
  makeEntry('auth.me.read', 'Accessibility Settings', '/app/settings/accessibility', 'settings', 'Access accessibility settings interface'),
  makeEntry('ui.theme.write', 'Brand Settings', '/app/settings/brand', 'settings', 'Access brand settings interface'),
  makeEntry('profile.user.update', 'User Settings', '/app/settings/users', 'settings', 'Access staff user settings interface'),
  makeEntry('global.services.manage', 'Global Services', '/app/settings/global-services', 'settings', 'Access global services catalog interface'),

  makeEntry('records.me.read', 'My Timeline', '/app/public/timeline', 'public', 'Access personal timeline interface'),
  makeEntry('doctor.search', 'Doctor Registry Search', '/app/public/doctor-registry', 'public', 'Access doctor registry search interface'),
  makeEntry('doctor.read', 'Doctor Profile', '/app/public/doctor-registry/:doctorId', 'public', 'Access doctor profile interface'),

  makeEntry('profile.search', 'Provider Dashboard', '/app/provider/dashboard', 'provider', 'Access provider dashboard interface'),
  makeEntry('profile.search', 'Patient Search', '/app/provider/patients', 'provider', 'Access patient search interface'),
  makeEntry('profile.user.read', 'Patient Profile', '/app/provider/patient/:nin', 'provider', 'Access patient profile interface'),
  makeEntry('encounters.read', 'Encounters', '/app/provider/encounters', 'encounters', 'Access encounters interface'),
  makeEntry('encounters.create', 'New Encounter', '/app/provider/encounters/new', 'encounters', 'Access encounter creation interface'),
  makeEntry('encounters.read', 'Encounter Details', '/app/provider/encounters/:id', 'encounters', 'Access encounter details interface'),
  makeEntry('encounters.update', 'Edit Encounter', '/app/provider/encounters/:id/edit', 'encounters', 'Access encounter update interface'),
  makeEntry('encounters.create', 'New Patient Encounter', '/app/provider/patient/:nin/encounters/new', 'encounters', 'Access patient-scoped encounter interface'),
  makeEntry('labs.read', 'Labs', '/app/provider/labs', 'labs', 'Access labs interface'),
  makeEntry('labs.create', 'New Lab Request', '/app/provider/labs/new', 'labs', 'Access lab request interface'),
  makeEntry('labs.read', 'Lab Details', '/app/provider/labs/:id', 'labs', 'Access lab details interface'),
  makeEntry('labs.update', 'Edit Lab Result', '/app/provider/labs/:id/edit', 'labs', 'Access lab update interface'),
  makeEntry('labs.create', 'New Patient Lab Request', '/app/provider/patient/:nin/labs/new', 'labs', 'Access patient-scoped lab request interface'),
  makeEntry('pharmacy.read', 'Pharmacy', '/app/provider/pharmacy', 'pharmacy', 'Access pharmacy interface'),
  makeEntry('pharmacy.create', 'New Prescription', '/app/provider/pharmacy/new', 'pharmacy', 'Access prescription creation interface'),
  makeEntry('pharmacy.read', 'Pharmacy Details', '/app/provider/pharmacy/:id', 'pharmacy', 'Access pharmacy details interface'),
  makeEntry('pharmacy.update', 'Edit Prescription', '/app/provider/pharmacy/:id/edit', 'pharmacy', 'Access prescription update interface'),
  makeEntry('pharmacy.create', 'New Patient Prescription', '/app/provider/patient/:nin/pharmacy/new', 'pharmacy', 'Access patient-scoped prescription interface'),

  makeEntry('governance.case.read', 'Taskforce Dashboard', '/app/taskforce/dashboard', 'taskforce', 'Access taskforce dashboard interface'),
  makeEntry('governance.case.read', 'Complaints', '/app/taskforce/complaints', 'taskforce', 'Access complaints interface'),
  makeEntry('governance.case.read', 'Complaint Details', '/app/taskforce/complaints/:id', 'taskforce', 'Access complaint details interface'),
  makeEntry('governance.case.read', 'Case Management', '/app/taskforce/cases', 'taskforce', 'Access cases interface'),
  makeEntry('governance.case.read', 'Case Details', '/app/taskforce/cases/:id', 'taskforce', 'Access case details interface'),
  makeEntry('audit.read', 'Governance Audit', '/app/governance/audit', 'governance', 'Access governance audit interface'),
  makeEntry('governance.case.read', 'Oversight', '/app/governance/oversight', 'governance', 'Access oversight interface'),

  makeEntry('emergency.inventory.search', 'Emergency Inventory', '/app/emergency', 'emergency', 'Access emergency inventory interface'),
  makeEntry('emergency.request.create', 'Emergency Request', '/app/emergency/request', 'emergency', 'Access emergency request interface'),
  makeEntry('emergency.request.read', 'Emergency Cases', '/app/emergency/cases', 'emergency', 'Access emergency cases interface'),
  makeEntry('emergency.request.read', 'Emergency Case Details', '/app/emergency/cases/:id', 'emergency', 'Access emergency case details interface'),

  makeEntry('superadmin.only', 'App Permissions', '/app/admin/access/app-permissions', 'admin', 'Access app permissions interface'),
  makeEntry('rbac.app.manage', 'App Roles', '/app/admin/access/app-roles', 'admin', 'Access app roles interface'),
  makeEntry('rbac.app.manage', 'User Access', '/app/admin/access/users/:userId', 'admin', 'Access user access interface'),
  makeEntry('geo.manage', 'Geo Mapping', '/app/admin/geo-mapping', 'admin', 'Access geography mapping interface'),
  makeEntry('rbac.org.manage', 'Organization Permissions', '/app/org/access/permissions', 'admin', 'Access organization permissions interface'),
  makeEntry('rbac.org.manage', 'Organization Roles', '/app/org/access/roles', 'admin', 'Access organization roles interface'),
  makeEntry('rbac.org.manage', 'Organization Staff Access', '/app/org/access/staff/:userId', 'admin', 'Access organization staff access interface'),
  makeEntry('org.list', 'Organizations', '/app/organizations', 'organization', 'Access organizations listing interface'),
  makeEntry('org.list_all', 'Organizations (All)', '/app/organizations', 'organization', 'Allow listing all organizations across the platform'),
  makeEntry('org.update', 'Organization Approvals', '/app/organizations/approvals', 'organization', 'Access organization approval review interface'),
  makeEntry('org.deleted.read', 'Deleted Organizations', '/app/organizations/deleted', 'organization', 'Access deleted organizations restoration interface'),
  makeEntry('org.read', 'Organization Details', '/app/organizations/:orgId', 'organization', 'Access organization details interface'),
  makeEntry('org.update', 'Update Organization', '/app/organizations/:orgId', 'organization', 'Update organization profile and operating details'),
  makeEntry('org.owner.assign', 'Assign Organization Owner', '/app/organizations/:orgId', 'organization', 'Assign or reassign organization ownership'),
  makeEntry('org.member.read', 'Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'Access organization staff interface'),
  makeEntry('org.member.add', 'Add Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'Add staff members to the organization'),
  makeEntry('org.member.invite', 'Invite Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'Invite staff members into the organization'),
  makeEntry('org.member.list', 'List Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'List staff members in the organization'),
  makeEntry('org.member.update', 'Update Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'Update organization staff details and assignments'),
  makeEntry('org.member.status.update', 'Change Organization Staff Status', '/app/organizations/:orgId/staff', 'organization', 'Change active or removed status for organization staff'),
  makeEntry('org.member.status.update', 'Remove Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'Remove organization staff access'),
  makeEntry('org.member.transfer', 'Transfer Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'Transfer staff within the organization scope'),
  makeEntry('org.member.history.read', 'View Organization Staff History', '/app/organizations/:orgId/staff', 'organization', 'View organization staff movement and exit history'),
  makeEntry('org.member.branch.assign', 'Assign Staff To Branch', '/app/organizations/:orgId/staff', 'organization', 'Assign organization staff to branch scope'),
  makeEntry('org.member.branch.update', 'Update Staff Branch Assignment', '/app/organizations/:orgId/staff', 'organization', 'Update branch assignments for organization staff'),
  makeEntry('org.member.branch.remove', 'Remove Staff Branch Assignment', '/app/organizations/:orgId/staff', 'organization', 'Remove a branch assignment from organization staff'),
  makeEntry('org.branch.assign', 'Assign Branch Coverage', '/app/organizations/:orgId/staff', 'organization', 'Assign branch coverage within organization membership'),
  makeEntry('org.branch.assignment.update', 'Update Branch Coverage', '/app/organizations/:orgId/staff', 'organization', 'Update branch coverage on organization membership'),
  makeEntry('org.list', 'Institutions', '/app/institutions', 'organization', 'Access institutions listing interface'),
  makeEntry('org.branch.create', 'Create Institution', '/app/institutions', 'organization', 'Create new institutions within the organization'),
  makeEntry('org.branch.read', 'Institution Directory', '/app/institutions', 'organization', 'View institutions within the organization'),
  makeEntry('org.read', 'Institution Details', '/app/institutions/:institutionId', 'organization', 'Access institution details interface'),
  makeEntry('org.branch.update', 'Update Institution', '/app/institutions/:institutionId', 'organization', 'Update institution details and configuration'),
  makeEntry('org.branch.delete', 'Delete Institution', '/app/institutions/:institutionId', 'organization', 'Delete an institution from the organization'),
  makeEntry('org.member.read', 'Institution Staff', '/app/institutions/:institutionId/staff', 'organization', 'Access institution staff interface'),
  makeEntry('org.member.branch.assign', 'Assign Institution Staff', '/app/institutions/:institutionId/staff', 'organization', 'Assign staff into the institution scope'),
  makeEntry('org.member.branch.update', 'Update Institution Staff', '/app/institutions/:institutionId/staff', 'organization', 'Update institution-scoped staff assignments'),
  makeEntry('org.member.branch.remove', 'Remove Institution Staff', '/app/institutions/:institutionId/staff', 'organization', 'Remove staff from the institution scope'),
  makeEntry('org.member.history.read', 'Institution Staff History', '/app/institutions/:institutionId/staff', 'organization', 'View institution staff movement and exit history'),
  makeEntry('org.list', 'Branches', '/app/branches', 'organization', 'Access branches listing interface'),
  makeEntry('org.branch.create', 'Create Branch', '/app/branches', 'organization', 'Create new branches within the organization'),
  makeEntry('org.branch.read', 'Branch Directory', '/app/branches', 'organization', 'View branches within the organization'),
  makeEntry('org.read', 'Branch Details', '/app/branches/:branchId', 'organization', 'Access branch details interface'),
  makeEntry('org.branch.update', 'Update Branch', '/app/branches/:branchId', 'organization', 'Update branch details and configuration'),
  makeEntry('org.branch.delete', 'Delete Branch', '/app/branches/:branchId', 'organization', 'Delete a branch from the organization'),
  makeEntry('org.member.read', 'Branch Staff', '/app/branches/:branchId/staff', 'organization', 'Access branch staff interface'),
  makeEntry('org.member.branch.assign', 'Assign Branch Staff', '/app/branches/:branchId/staff', 'organization', 'Assign staff into the branch scope'),
  makeEntry('org.member.branch.update', 'Update Branch Staff', '/app/branches/:branchId/staff', 'organization', 'Update branch-scoped staff assignments'),
  makeEntry('org.member.branch.remove', 'Remove Branch Staff', '/app/branches/:branchId/staff', 'organization', 'Remove staff from the branch scope'),
  makeEntry('org.member.history.read', 'Branch Staff History', '/app/branches/:branchId/staff', 'organization', 'View branch staff movement and exit history'),
  makeEntry('admin.settings.manage', 'Admin System Settings', '/app/admin/system-settings', 'admin', 'Access admin system settings interface'),

  makeEntry('analytics.view', 'Analytics Dashboard', '/app/analytics/dashboard', 'analytics', 'Access analytics dashboard interface'),
  makeEntry('analytics.view', 'Health Metrics', '/app/analytics/metrics', 'analytics', 'Access health metrics interface'),
  makeEntry('reports.view', 'Reports', '/app/reports', 'reports', 'Access reports interface'),
  makeEntry('reports.view', 'Report Details', '/app/reports/:reportId', 'reports', 'Access report details interface'),
  makeEntry('compliance.view', 'Data Quality', '/app/compliance/data-quality', 'compliance', 'Access data quality interface'),
  makeEntry('compliance.view', 'Compliance Dashboard', '/app/compliance/dashboard', 'compliance', 'Access compliance dashboard interface'),
  makeEntry('institution.dashboard.view', 'Institution Dashboard', '/app/institution/dashboard', 'institution', 'Access institution dashboard interface'),

  makeEntry('integrations.view', 'Integrations', '/app/integrations', 'integrations', 'Access integrations interface'),
  makeEntry('integrations.view', 'Integration Details', '/app/integrations/:id', 'integrations', 'Access integration details interface'),
  makeEntry('api.keys.manage', 'API Keys', '/app/integrations/api-keys', 'integrations', 'Access integration API keys interface'),
  makeEntry('sync.monitor.view', 'Sync Monitor', '/app/integrations/sync', 'integrations', 'Access synchronization monitor interface'),

  makeEntry('notifications.view', 'Notifications', '/app/notifications', 'system', 'Access notifications interface'),
  makeEntry('alerts.view', 'Alerts', '/app/alerts', 'system', 'Access alerts interface'),
  makeEntry('system.activity.view', 'System Activity', '/app/system/activity', 'system', 'Access system activity interface'),
  makeEntry('system.monitoring.view', 'System Monitoring', '/app/system/monitoring', 'system', 'Access system monitoring interface'),
  makeEntry('system.configuration.manage', 'System Configuration', '/app/system/configuration', 'system', 'Access system configuration interface'),
  makeEntry('system.observability.view', 'System Observability', '/app/system/observability', 'system', 'Access system observability interface'),
  makeEntry('system.health.view', 'System Health', '/app/system/health', 'system', 'Access system health interface'),
  makeEntry('dev.tools.view', 'Developer Tools', '/app/dev-tools', 'system', 'Access developer tools interface'),
];

export function findInterfacePermission(key: string): InterfacePermission | null {
  return interfacePermissions.find((entry) => entry.key === key) ?? null;
}

export function findInterfacePermissions(key: string): InterfacePermission[] {
  return interfacePermissions.filter((entry) => entry.key === key);
}

const moduleLabelMap: Record<string, string> = {
  admin: 'Administration',
  analytics: 'Analytics',
  compliance: 'Compliance',
  core: 'Core',
  emergency: 'Emergency',
  encounters: 'Encounters',
  governance: 'Taskforce',
  institution: 'Institution',
  integrations: 'Integrations',
  labs: 'Labs',
  organization: 'Organization',
  pharmacy: 'Pharmacy',
  provider: 'Provider',
  public: 'Public',
  reports: 'Reports',
  settings: 'Settings',
  system: 'System',
  taskforce: 'Taskforce',
};

const actionLabelMap: Record<string, string> = {
  add: 'Add',
  assign: 'Assign',
  create: 'Create',
  delete: 'Delete',
  invite: 'Invite',
  list: 'List',
  manage: 'Manage',
  read: 'View',
  remove: 'Remove',
  search: 'Search',
  transfer: 'Transfer',
  update: 'Update',
  view: 'View',
  write: 'Update',
};

function startCase(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function toModuleLabel(moduleName: string): string {
  const normalized = String(moduleName || '').trim().toLowerCase();
  return moduleLabelMap[normalized] || startCase(normalized || 'general');
}

function deriveActionLabel(permissionKey: string, description: string): string {
  const normalizedKey = String(permissionKey || '').trim().toLowerCase();
  const normalizedDescription = String(description || '').trim().toLowerCase();
  if (normalizedKey.includes('.status.update') || normalizedDescription.includes('status')) {
    return 'Change Status';
  }
  if (normalizedKey.includes('.history.read') || normalizedDescription.includes('history')) {
    return 'View History';
  }
  const parts = normalizedKey.split('.').filter(Boolean);
  const directAction = parts.length > 0 ? parts[parts.length - 1] : '';
  if (actionLabelMap[directAction]) {
    return actionLabelMap[directAction];
  }
  return startCase(directAction || 'access');
}

function stripInterfacePrefix(description: string): string {
  const raw = String(description || '').trim();
  if (!raw) return '';
  const withoutAccess = raw.replace(/^access\s+/i, '');
  const withoutInterface = withoutAccess.replace(/\s+interface$/i, '');
  const normalized = withoutInterface.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function deriveFallbackTitle(key: string, moduleName: string, description: string): string {
  const descriptionTitle = stripInterfacePrefix(description);
  if (descriptionTitle) {
    return descriptionTitle;
  }
  const groupLabel = toModuleLabel(moduleName);
  const actionLabel = deriveActionLabel(key, description);
  return `${actionLabel} ${groupLabel}`;
}

export function getPermissionDisplayMeta(permission: Pick<InterfacePermission, 'key' | 'module' | 'description'>): PermissionDisplayMeta {
  const rawKey = String(permission.key || '').trim();
  const moduleName = String(permission.module || '').trim().toLowerCase();
  const description = String(permission.description || '').trim();
  const interfaces = findInterfacePermissions(rawKey);
  const uniqueInterfaceLabels = Array.from(new Set(
    interfaces.map((entry) => String(entry.interfaceLabel || '').trim()).filter(Boolean),
  ));
  const uniqueRoutes = Array.from(new Set(
    interfaces.map((entry) => String(entry.route || '').trim()).filter(Boolean),
  ));
  const groupLabel = toModuleLabel(
    interfaces.find((entry) => String(entry.module || '').trim())?.module || moduleName,
  );
  const actionLabel = deriveActionLabel(rawKey, description);
  const title = uniqueInterfaceLabels.length === 1
    ? uniqueInterfaceLabels[0]
    : deriveFallbackTitle(rawKey, moduleName, description);
  const interfaceSummary = uniqueInterfaceLabels.length > 0
    ? uniqueInterfaceLabels.slice(0, 2).join(', ')
    : null;
  const routeSummary = uniqueRoutes.length > 0
    ? uniqueRoutes[0]
    : null;

  return {
    title,
    groupLabel,
    actionLabel,
    helperText: description || deriveFallbackTitle(rawKey, moduleName, description),
    interfaceSummary,
    routeSummary,
    interfaceCount: uniqueInterfaceLabels.length,
    rawKey,
  };
}

export function groupPermissionsByDisplay<T extends Pick<InterfacePermission, 'key' | 'module' | 'description'>>(
  permissions: T[],
): Array<PermissionDisplayGroup<T>> {
  const grouped = permissions.reduce<Map<string, T[]>>((acc, permission) => {
    const label = getPermissionDisplayMeta(permission).groupLabel || 'General';
    const current = acc.get(label) ?? [];
    current.push(permission);
    acc.set(label, current);
    return acc;
  }, new Map());

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, items]) => ({
      label,
      items: [...items].sort((left, right) => {
        const leftMeta = getPermissionDisplayMeta(left);
        const rightMeta = getPermissionDisplayMeta(right);
        const titleCompare = leftMeta.title.localeCompare(rightMeta.title);
        if (titleCompare !== 0) return titleCompare;
        return String(left.key || '').localeCompare(String(right.key || ''));
      }),
    }));
}
