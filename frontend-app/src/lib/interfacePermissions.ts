export type InterfacePermission = {
  key: string;
  interfaceLabel: string;
  route: string;
  module: string;
  description: string;
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

  makeEntry('records.me.read', 'Public Timeline', '/app/public/timeline', 'public', 'Access public timeline interface'),
  makeEntry('auth.me.read', 'Doctor Registry Search', '/app/public/doctor-registry', 'public', 'Access doctor registry search interface'),
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
  makeEntry('rbac.org.manage', 'Organization Permissions', '/app/org/access/permissions', 'admin', 'Access organization permissions interface'),
  makeEntry('rbac.org.manage', 'Organization Roles', '/app/org/access/roles', 'admin', 'Access organization roles interface'),
  makeEntry('rbac.org.manage', 'Organization Staff Access', '/app/org/access/staff/:userId', 'admin', 'Access organization staff access interface'),
  makeEntry('org.list', 'Organizations', '/app/organizations', 'organization', 'Access organizations listing interface'),
  makeEntry('org.read', 'Organization Details', '/app/organizations/:orgId', 'organization', 'Access organization details interface'),
  makeEntry('org.member.read', 'Organization Staff', '/app/organizations/:orgId/staff', 'organization', 'Access organization staff interface'),
  makeEntry('org.list', 'Institutions', '/app/institutions', 'organization', 'Access institutions listing interface'),
  makeEntry('org.read', 'Institution Details', '/app/institutions/:institutionId', 'organization', 'Access institution details interface'),
  makeEntry('org.member.read', 'Institution Staff', '/app/institutions/:institutionId/staff', 'organization', 'Access institution staff interface'),
  makeEntry('org.list', 'Branches', '/app/branches', 'organization', 'Access branches listing interface'),
  makeEntry('org.read', 'Branch Details', '/app/branches/:branchId', 'organization', 'Access branch details interface'),
  makeEntry('org.member.read', 'Branch Staff', '/app/branches/:branchId/staff', 'organization', 'Access branch staff interface'),
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
