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
  makeEntry('auth.me.read', 'My Profile', '/app/settings/my-profile', 'settings', 'Access my profile interface'),
  makeEntry('auth.me.read', 'Appearance Settings', '/app/settings/appearance', 'settings', 'Access appearance settings interface'),
  makeEntry('auth.me.read', 'Accessibility Settings', '/app/settings/accessibility', 'settings', 'Access accessibility settings interface'),
  makeEntry('ui.theme.write', 'Brand Settings', '/app/settings/brand', 'settings', 'Access brand settings interface'),
  makeEntry('profile.user.update', 'Profile Management', '/app/settings/users', 'settings', 'Access profile management interface'),
  makeEntry('global.services.manage', 'Global Services', '/app/settings/global-services', 'settings', 'Access global services catalog interface'),
  makeEntry('global.services.create', 'Create Global Service', '/app/settings/global-services', 'settings', 'Create a new global service catalog entry'),
  makeEntry('global.services.update', 'Update Global Service', '/app/settings/global-services', 'settings', 'Update a global service catalog entry'),
  makeEntry('global.services.delete', 'Delete Global Service', '/app/settings/global-services', 'settings', 'Delete a global service catalog entry'),

  makeEntry('records.me.read', 'My Timeline', '/app/public/timeline', 'public', 'Access personal timeline interface'),
  makeEntry('doctor.search', 'Doctor Registry Search', '/app/public/doctor-registry', 'public', 'Access doctor registry search interface'),
  makeEntry('doctor.read', 'Doctor Profile', '/app/public/doctor-registry/:doctorId', 'public', 'Access doctor profile interface'),

  makeEntry('profile.search', 'Provider Dashboard', '/app/provider/dashboard', 'provider', 'Access provider dashboard interface'),
  makeEntry('profile.search', 'Patient Search', '/app/provider/patients', 'provider', 'Access patient search interface'),
  makeEntry('profile.placeholder.create', 'Patient Intake', '/app/provider/intake', 'provider', 'Register a patient into the organization-wide care search workflow'),
  makeEntry('profile.user.read', 'Patient Profile', '/app/provider/patient/:nin', 'provider', 'Access patient profile interface'),
  makeEntry('care.workspace.read', 'Patient Care', '/app/care', 'care', 'Access patient care workspace interface'),
  makeEntry('profile.search', 'Care Patient Search', '/app/care/patients', 'care', 'Access patient search in care workspace'),
  makeEntry('profile.placeholder.create', 'Patient Intake', '/app/care/intake', 'care', 'Register a patient into the organization-wide care search workflow from the current institution or branch context'),
  makeEntry('profile.user.read', 'Care Patient Profile', '/app/care/patient/:nin', 'care', 'Access patient profile in care workspace'),
  makeEntry('records.nin.read', 'Care Timeline', '/app/care/patient/:nin', 'care', 'View patient timeline within institution or branch care workspace'),
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

  makeEntry('rbac.app.manage', 'App Permissions', '/app/admin/access/app-permissions', 'admin', 'Access app permissions interface'),
  makeEntry('rbac.app.manage', 'App Roles', '/app/admin/access/app-roles', 'admin', 'Access app roles interface'),
  makeEntry('rbac.app.manage', 'User Access', '/app/admin/access/users/:userId', 'admin', 'Access user access interface'),
  makeEntry('geo.manage', 'Geo Mapping', '/app/admin/geo-mapping', 'admin', 'Access geography mapping interface'),
  makeEntry('rbac.org.manage', 'Permissions', '/app/org/access/permissions', 'admin', 'Access organization permissions interface'),
  makeEntry('rbac.org.manage', 'Roles', '/app/org/access/roles', 'admin', 'Access organization roles interface'),
  makeEntry('rbac.org.manage', 'Staff Access', '/app/org/access/staff/:userId', 'admin', 'Access organization staff access interface'),
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

const navigationSectionLabelMap: Record<string, string> = {
  admin: 'Administration',
  analytics: 'Analytics',
  care: 'Care',
  compliance: 'Compliance',
  core: 'Core',
  emergency: 'Emergency',
  encounters: 'Provider',
  governance: 'Taskforce',
  institution: 'Institution',
  integrations: 'Integrations',
  lab: 'Provider',
  labs: 'Provider',
  membership: 'Administration',
  organization: 'Administration',
  pharmacy: 'Provider',
  provider: 'Provider',
  profile: 'Core',
  public: 'Public',
  reports: 'Analytics',
  rbac: 'Administration',
  settings: 'Core',
  system: 'System',
  taskforce: 'Taskforce',
  ui_theme: 'Core',
  'ui-theme': 'Core',
  geography: 'Administration',
  catalog: 'Core',
  providers: 'Administration',
  auth: 'Core',
  records: 'Provider',
  'doctor-registry': 'Public',
};

const navigationSectionOrder = [
  'Core',
  'Public',
  'Provider',
  'Care',
  'Taskforce',
  'Emergency',
  'Analytics',
  'Compliance',
  'Institution',
  'Integrations',
  'Administration',
  'System',
] as const;

const navigationSectionIndex = new Map(
  navigationSectionOrder.map((label, index) => [label, index] as const),
);

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
  return navigationSectionLabelMap[normalized] || startCase(normalized || 'general');
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

function withCapability(text: string): string {
  return `When this is turned on, the user can ${text}.`;
}

function deriveFriendlyPermissionExplanation(
  permissionKey: string,
  _moduleName: string,
  title: string,
  groupLabel: string,
): string | null {
  const key = String(permissionKey || '').trim().toLowerCase();
  const last = key.split('.').filter(Boolean).at(-1) || '';

  switch (key) {
    case 'superadmin.only':
      return withCapability('use screens reserved for the platform super administrator');
    case 'auth.me.read':
      return withCapability('open the app and view their own signed-in account details');
    case 'auth.contact.phone.write':
      return withCapability('add or update a phone number on the user account');
    case 'auth.contact.email.write':
      return withCapability('add or update an email address on the user account');
    case 'auth.password.change':
      return withCapability('change the password for the signed-in account');
    case 'nin.profile.read':
      return withCapability('view identity details pulled from the person’s NIN record');
    case 'profile.me.read':
      return withCapability('view their own profile record inside NHRS');
    case 'profile.me.update':
      return withCapability('update the parts of their own profile they are allowed to change');
    case 'profile.nin.refresh.request':
      return withCapability('request a fresh pull of profile data from the NIN source');
    case 'ui.theme.write':
      return withCapability('change branding, theme, and other visual appearance settings');
    case 'rbac.app.manage':
      return withCapability('manage app-wide roles, permissions, and access rules across the whole platform');
    case 'rbac.org.manage':
      return withCapability('manage organization roles, permissions, and staff access rules');
    case 'org.manage':
      return withCapability('create, view, update, and remove organization records on the platform');
    case 'geo.manage':
      return withCapability('manage the geography master data such as regions, states, and LGAs');
    case 'integrations.view':
      return withCapability('open integration settings and view configured connections');
    case 'api.keys.manage':
      return withCapability('create, view, update, and revoke API keys');
    case 'sync.monitor.view':
      return withCapability('monitor synchronization jobs and see their current status');
    case 'global.services.manage':
      return withCapability('manage the master list of global services used across the system');
    case 'global.services.create':
      return withCapability('add a new service to the master global services list');
    case 'global.services.update':
      return withCapability('edit an existing service in the master global services list');
    case 'global.services.delete':
      return withCapability('remove a service from the master global services list');
    case 'care.workspace.read':
      return withCapability('open the Care workspace for patient treatment activities in an institution or branch');
    case 'profile.search':
      return withCapability('search for patient or user profiles that are available in this workspace');
    case 'profile.user.read':
      return withCapability('open a person’s profile and view their recorded details');
    case 'profile.user.update':
      return withCapability('fill in or update the profile details the user is allowed to manage');
    case 'profile.placeholder.create':
      return withCapability('start patient intake for someone who needs to be registered into care');
    case 'records.me.read':
      return withCapability('view their own personal health timeline');
    case 'records.nin.read':
      return withCapability('view a patient’s timeline and record history using that patient’s NIN');
    case 'records.entry.create':
      return withCapability('add a new clinical or provider record to a patient timeline');
    case 'records.entry.update':
      return withCapability('edit an existing timeline record');
    case 'records.entry.hide':
      return withCapability('hide a timeline record from normal view');
    case 'records.symptoms.create':
      return withCapability('record symptoms reported by the user');
    case 'institution.dashboard.view':
      return withCapability('open the institution dashboard and view its summary information');
    case 'analytics.view':
      return withCapability('open analytics dashboards and see reporting insights');
    case 'reports.view':
      return withCapability('view reports and open report details');
    case 'compliance.view':
      return withCapability('open compliance and data quality screens');
    case 'notifications.view':
      return withCapability('view notifications sent to the user');
    case 'alerts.view':
      return withCapability('view alerts that need attention');
    case 'system.activity.view':
      return withCapability('view system activity and audit-style operational events');
    case 'system.monitoring.view':
      return withCapability('view system monitoring data and service status information');
    case 'system.configuration.manage':
      return withCapability('change system configuration settings');
    case 'system.observability.view':
      return withCapability('view logs, traces, and observability information');
    case 'system.health.view':
      return withCapability('view overall system health information');
    case 'dev.tools.view':
      return withCapability('open developer tools used for technical support or diagnostics');
  }

  if (key.startsWith('encounters.')) {
    if (last === 'read') return withCapability('view patient visit records, including outpatient, inpatient, and emergency encounters');
    if (last === 'create') return withCapability('create a new patient visit record and capture the care given during that visit');
    if (last === 'update') return withCapability('edit a patient visit record before it is finalized');
    if (last === 'finalize') return withCapability('mark a patient visit record as complete and part of the official record');
  }

  if (key.startsWith('labs.')) {
    if (last === 'read') return withCapability('view lab requests, results, and laboratory workflow details');
    if (last === 'create') return withCapability('create a new laboratory request for a patient');
    if (last === 'update') return withCapability('enter or update laboratory results');
    if (last === 'complete') return withCapability('mark a lab result as completed');
  }

  if (key.startsWith('lab.')) {
    if (last === 'write') return withCapability('enter or update laboratory results');
  }

  if (key.startsWith('pharmacy.')) {
    if (last === 'read') return withCapability('view prescriptions and pharmacy workflow details');
    if (last === 'create') return withCapability('create a new prescription for a patient');
    if (last === 'update') return withCapability('edit an existing prescription');
    if (last === 'dispense') return withCapability('record that a prescription has been dispensed to the patient');
  }

  if (key.startsWith('org.owner.')) {
    return withCapability('assign or change who is responsible as the organization owner');
  }

  if (key.startsWith('org.list_all')) {
    return withCapability('see every organization on the platform, not just the ones already in the current working context');
  }

  if (key.startsWith('org.list')) {
    return withCapability('view the available organizations, institutions, or branches in this administration area');
  }

  if (key.startsWith('org.read')) {
    return withCapability('open an organization, institution, or branch record and view its details');
  }

  if (key.startsWith('org.update')) {
    return withCapability('change the details or configuration of an organization, institution, or branch');
  }

  if (key.startsWith('org.create')) {
    return withCapability('create a new organization record');
  }

  if (key.startsWith('org.search')) {
    return withCapability('search through organization records on the platform');
  }

  if (key.startsWith('org.deleted.read')) {
    return withCapability('view organizations that were deleted or archived');
  }

  if (key.startsWith('org.branch.create')) {
    return withCapability('create a new institution or branch inside the organization');
  }

  if (key.startsWith('org.branch.read')) {
    return withCapability('view institution or branch records inside the organization');
  }

  if (key.startsWith('org.branch.update')) {
    return withCapability('edit institution or branch details inside the organization');
  }

  if (key.startsWith('org.branch.delete')) {
    return withCapability('remove an institution or branch record from the organization');
  }

  if (key.startsWith('org.branch.assign')) {
    return withCapability('assign branch coverage to a staff membership');
  }

  if (key.startsWith('org.branch.assignment.update')) {
    return withCapability('change the branch coverage already assigned to a staff membership');
  }

  if (key.startsWith('org.member.add')) {
    return withCapability('add someone as staff inside the organization');
  }

  if (key.startsWith('org.member.invite')) {
    return withCapability('invite someone to join the organization as staff');
  }

  if (key.startsWith('org.member.read') || key.startsWith('org.member.list')) {
    return withCapability('view staff records and staff details inside the organization');
  }

  if (key.startsWith('org.member.update')) {
    return withCapability('edit a staff member’s details, assignments, or related settings');
  }

  if (key.startsWith('org.member.status.update')) {
    return withCapability('change whether a staff member is active, inactive, removed, or in another status');
  }

  if (key.startsWith('org.member.branch.assign')) {
    return withCapability('assign a staff member to a specific institution or branch');
  }

  if (key.startsWith('org.member.branch.update')) {
    return withCapability('change a staff member’s institution or branch assignment');
  }

  if (key.startsWith('org.member.branch.remove')) {
    return withCapability('remove a staff member from an institution or branch assignment');
  }

  if (key.startsWith('org.member.transfer')) {
    return withCapability('move a staff member from one assignment or branch coverage to another');
  }

  if (key.startsWith('org.member.history.read')) {
    return withCapability('view a staff member’s movement, assignment, and exit history');
  }

  if (key.startsWith('membership.user.read')) {
    return withCapability('view the memberships linked to a user across organizations');
  }

  if (key.startsWith('membership.user.history.read')) {
    return withCapability('view a user’s membership history and movement across organizations');
  }

  if (key.startsWith('doctor.search')) {
    return withCapability('search the doctor registry');
  }

  if (key.startsWith('doctor.register')) {
    return withCapability('create a new doctor profile in the registry');
  }

  if (key.startsWith('doctor.read')) {
    return withCapability('view a doctor’s profile and registration details');
  }

  if (key.startsWith('doctor.verify')) {
    return withCapability('mark a doctor’s license or registration as verified');
  }

  if (key.startsWith('doctor.suspend')) {
    return withCapability('suspend a doctor’s license or active standing');
  }

  if (key.startsWith('doctor.revoke')) {
    return withCapability('revoke a doctor’s license or registration');
  }

  if (key.startsWith('doctor.reinstate')) {
    return withCapability('reinstate a doctor after a suspension or revocation');
  }

  if (key.startsWith('emergency.request.create')) {
    return withCapability('create a new emergency request');
  }

  if (key.startsWith('emergency.request.read')) {
    return withCapability('view emergency requests and their details');
  }

  if (key.startsWith('emergency.request.update_status')) {
    return withCapability('change the status of an emergency request');
  }

  if (key.startsWith('emergency.response.create')) {
    return withCapability('create a response to an emergency request');
  }

  if (key.startsWith('emergency.room.read')) {
    return withCapability('view the emergency coordination room');
  }

  if (key.startsWith('emergency.room.message.create')) {
    return withCapability('send messages inside the emergency coordination room');
  }

  if (key.startsWith('emergency.inventory.search')) {
    return withCapability('search emergency inventory across providers');
  }

  if (key.startsWith('emergency.inventory.upsert')) {
    return withCapability('add, edit, or refresh provider emergency inventory records');
  }

  if (key.startsWith('taskforce.unit.create')) {
    return withCapability('create a new taskforce unit');
  }

  if (key.startsWith('taskforce.unit.read')) {
    return withCapability('view taskforce units');
  }

  if (key.startsWith('taskforce.unit.update')) {
    return withCapability('edit taskforce unit details');
  }

  if (key.startsWith('taskforce.member.manage')) {
    return withCapability('add, update, or remove members of a taskforce unit');
  }

  if (key.startsWith('governance.case.create')) {
    return withCapability('create a new governance case');
  }

  if (key.startsWith('governance.case.read')) {
    return withCapability('view governance cases, complaints, and oversight records');
  }

  if (key.startsWith('governance.case.update_status')) {
    return withCapability('change the status of a governance case');
  }

  if (key.startsWith('governance.case.escalate')) {
    return withCapability('escalate a governance case for higher attention');
  }

  if (key.startsWith('governance.case.room.read')) {
    return withCapability('view the discussion room for a governance case');
  }

  if (key.startsWith('governance.case.room.message.create')) {
    return withCapability('send messages inside a governance case room');
  }

  if (key.startsWith('governance.correction.propose')) {
    return withCapability('propose a correction to a governance record or decision');
  }

  if (key.startsWith('governance.correction.approve')) {
    return withCapability('approve a proposed governance correction');
  }

  if (key.startsWith('governance.correction.reject')) {
    return withCapability('reject a proposed governance correction');
  }

  const subject = title || `${groupLabel.toLowerCase()} items`;
  if (last === 'read' || last === 'view') return withCapability(`view ${subject.toLowerCase()}`);
  if (last === 'search') return withCapability(`search ${subject.toLowerCase()}`);
  if (last === 'create') return withCapability(`create ${subject.toLowerCase()}`);
  if (last === 'update' || last === 'write') return withCapability(`change ${subject.toLowerCase()}`);
  if (last === 'delete' || last === 'remove') return withCapability(`remove ${subject.toLowerCase()}`);
  if (last === 'manage') return withCapability(`manage ${subject.toLowerCase()}`);
  if (last === 'assign') return withCapability(`assign ${subject.toLowerCase()}`);
  if (last === 'invite') return withCapability(`send invitations related to ${subject.toLowerCase()}`);
  if (last === 'list') return withCapability(`see the list of ${subject.toLowerCase()}`);

  return null;
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
  const helperText = deriveFriendlyPermissionExplanation(rawKey, moduleName, title, groupLabel)
    || description
    || deriveFallbackTitle(rawKey, moduleName, description);

  return {
    title,
    groupLabel,
    actionLabel,
    helperText,
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
    .sort(([left], [right]) => {
      const leftOrder = navigationSectionIndex.get(left);
      const rightOrder = navigationSectionIndex.get(right);
      if (leftOrder != null && rightOrder != null) return leftOrder - rightOrder;
      if (leftOrder != null) return -1;
      if (rightOrder != null) return 1;
      return left.localeCompare(right);
    })
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
