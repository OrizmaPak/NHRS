import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Archive,
  AlertOctagon,
  BarChart3,
  Building2,
  BuildingIcon,
  Cog,
  ClipboardList,
  Database,
  FileSpreadsheet,
  Gauge,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Link2,
  NotebookTabs,
  SearchCheck,
  Search,
  ShieldCheck,
  UserCog,
  Shield,
  Settings,
  ShieldAlert,
  Siren,
  Scale,
  MapPinned,
  Wrench,
  UserRoundSearch,
  Workflow,
} from 'lucide-react';

export type NavigationItem = {
  label: string;
  to: string;
  permission?: string | string[];
  contextTypes?: Array<'public' | 'platform' | 'organization' | 'state' | 'taskforce'>;
  icon: LucideIcon;
  group:
    | 'Core'
    | 'Public'
    | 'Provider'
    | 'Taskforce'
    | 'Emergency'
    | 'Analytics'
    | 'Integrations'
    | 'Compliance'
    | 'Institution'
    | 'Administration'
    | 'System';
};

export const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', to: '/app', permission: 'auth.me.read', icon: LayoutDashboard, group: 'Core' },
  { label: 'Settings', to: '/app/settings', permission: 'auth.me.read', icon: Settings, group: 'Core' },

  { label: 'My Timeline', to: '/app/public/timeline', permission: 'records.me.read', contextTypes: ['public', 'platform'], icon: Activity, group: 'Public' },
  { label: 'Facilities', to: '/app/public/organizations', contextTypes: ['public', 'platform', 'organization'], icon: Building2, group: 'Public' },
  { label: 'Doctor Registry', to: '/app/public/doctor-registry', permission: 'doctor.search', contextTypes: ['public', 'platform'], icon: UserRoundSearch, group: 'Public' },

  {
    label: 'Provider Hub',
    to: '/app/provider/dashboard',
    permission: 'profile.search',
    contextTypes: ['platform'],
    icon: Building2,
    group: 'Provider',
  },
  {
    label: 'Patient Search',
    to: '/app/provider/patients',
    permission: 'profile.search',
    contextTypes: ['platform'],
    icon: Search,
    group: 'Provider',
  },
  {
    label: 'Encounters',
    to: '/app/provider/encounters',
    permission: 'encounters.read',
    contextTypes: ['platform'],
    icon: ClipboardList,
    group: 'Provider',
  },
  {
    label: 'Labs',
    to: '/app/provider/labs',
    permission: 'labs.read',
    contextTypes: ['platform'],
    icon: NotebookTabs,
    group: 'Provider',
  },
  {
    label: 'Pharmacy',
    to: '/app/provider/pharmacy',
    permission: 'pharmacy.read',
    contextTypes: ['platform'],
    icon: BuildingIcon,
    group: 'Provider',
  },

  { label: 'Taskforce', to: '/app/taskforce/dashboard', permission: 'governance.case.read', contextTypes: ['platform'], icon: ShieldAlert, group: 'Taskforce' },
  { label: 'Complaints', to: '/app/taskforce/complaints', permission: 'governance.case.read', contextTypes: ['platform'], icon: AlertOctagon, group: 'Taskforce' },
  { label: 'Case Management', to: '/app/taskforce/cases', permission: 'governance.case.read', contextTypes: ['platform'], icon: ClipboardList, group: 'Taskforce' },
  { label: 'Governance Audit', to: '/app/governance/audit', permission: 'audit.read', contextTypes: ['platform'], icon: NotebookTabs, group: 'Taskforce' },
  { label: 'Oversight', to: '/app/governance/oversight', permission: 'governance.case.read', contextTypes: ['platform'], icon: Scale, group: 'Taskforce' },

  { label: 'Emergency Inventory', to: '/app/emergency', permission: 'emergency.inventory.search', contextTypes: ['platform'], icon: Siren, group: 'Emergency' },
  { label: 'Emergency Cases', to: '/app/emergency/cases', permission: 'emergency.request.read', contextTypes: ['platform'], icon: AlertOctagon, group: 'Emergency' },
  { label: 'Notifications', to: '/app/notifications', permission: 'notifications.view', contextTypes: ['platform'], icon: ShieldCheck, group: 'Emergency' },
  { label: 'Alerts', to: '/app/alerts', permission: 'alerts.view', contextTypes: ['platform'], icon: AlertOctagon, group: 'Emergency' },

  { label: 'Analytics Dashboard', to: '/app/analytics/dashboard', permission: 'analytics.view', contextTypes: ['platform'], icon: BarChart3, group: 'Analytics' },
  { label: 'Health Metrics', to: '/app/analytics/metrics', permission: 'analytics.view', contextTypes: ['platform'], icon: Gauge, group: 'Analytics' },
  { label: 'Reports', to: '/app/reports', permission: 'reports.view', contextTypes: ['platform'], icon: FileSpreadsheet, group: 'Analytics' },

  { label: 'Data Quality', to: '/app/compliance/data-quality', permission: 'compliance.view', contextTypes: ['platform'], icon: SearchCheck, group: 'Compliance' },
  { label: 'Compliance Dashboard', to: '/app/compliance/dashboard', permission: 'compliance.view', contextTypes: ['platform'], icon: ShieldCheck, group: 'Compliance' },

  { label: 'Institution Dashboard', to: '/app/institution/dashboard', permission: 'institution.dashboard.view', contextTypes: ['platform'], icon: HeartPulse, group: 'Institution' },

  { label: 'Integrations', to: '/app/integrations', permission: 'integrations.view', contextTypes: ['platform', 'organization'], icon: Link2, group: 'Integrations' },
  { label: 'API Keys', to: '/app/integrations/api-keys', permission: 'api.keys.manage', contextTypes: ['platform', 'organization'], icon: KeyRound, group: 'Integrations' },
  { label: 'Sync Monitor', to: '/app/integrations/sync', permission: 'sync.monitor.view', contextTypes: ['platform'], icon: Workflow, group: 'Integrations' },

  { label: 'App Permissions', to: '/app/admin/access/app-permissions', permission: 'superadmin.only', contextTypes: ['platform'], icon: Shield, group: 'Administration' },
  { label: 'App Roles', to: '/app/admin/access/app-roles', permission: 'rbac.app.manage', contextTypes: ['platform'], icon: ShieldAlert, group: 'Administration' },
  { label: 'User Access', to: '/app/admin/access/users/self', permission: 'rbac.app.manage', contextTypes: ['platform'], icon: UserCog, group: 'Administration' },
  { label: 'Geo Mapping', to: '/app/admin/geo-mapping', permission: 'geo.manage', contextTypes: ['platform'], icon: MapPinned, group: 'Administration' },
  { label: 'Global Services', to: '/app/settings/global-services', permission: 'global.services.manage', contextTypes: ['platform', 'organization'], icon: ClipboardList, group: 'Administration' },
  { label: 'Org Permissions', to: '/app/org/access/permissions', permission: 'rbac.org.manage', contextTypes: ['organization'], icon: Shield, group: 'Administration' },
  { label: 'Org Roles', to: '/app/org/access/roles', permission: 'rbac.org.manage', contextTypes: ['organization'], icon: ShieldAlert, group: 'Administration' },
  { label: 'Org Staff Access', to: '/app/org/access/staff/self', permission: 'rbac.org.manage', contextTypes: ['organization'], icon: UserCog, group: 'Administration' },
  { label: 'Organizations', to: '/app/organizations', permission: ['org.list', 'org.read'], contextTypes: ['platform', 'organization'], icon: Building2, group: 'Administration' },
  { label: 'Organization Approvals', to: '/app/organizations/approvals', permission: 'org.update', contextTypes: ['platform'], icon: ShieldCheck, group: 'Administration' },
  { label: 'Deleted Organizations', to: '/app/organizations/deleted', permission: 'org.deleted.read', contextTypes: ['platform'], icon: Archive, group: 'Administration' },
  { label: 'Institutions', to: '/app/institutions', permission: 'org.list', contextTypes: ['organization'], icon: BuildingIcon, group: 'Administration' },
  { label: 'Branches', to: '/app/branches', permission: 'org.list', contextTypes: ['organization'], icon: Workflow, group: 'Administration' },
  { label: 'Admin Settings', to: '/app/admin/system-settings', permission: 'admin.settings.manage', contextTypes: ['platform'], icon: Settings, group: 'Administration' },

  {
    label: 'System Activity',
    to: '/app/system/activity',
    permission: 'system.activity.view',
    contextTypes: ['platform'],
    icon: Activity,
    group: 'System',
  },
  {
    label: 'System Monitoring',
    to: '/app/system/monitoring',
    permission: 'system.monitoring.view',
    contextTypes: ['platform'],
    icon: Database,
    group: 'System',
  },
  {
    label: 'System Health',
    to: '/app/system/health',
    permission: 'system.health.view',
    contextTypes: ['platform'],
    icon: Gauge,
    group: 'System',
  },
  {
    label: 'Observability',
    to: '/app/system/observability',
    permission: 'system.observability.view',
    contextTypes: ['platform'],
    icon: Cog,
    group: 'System',
  },
  {
    label: 'System Config',
    to: '/app/system/configuration',
    permission: 'system.configuration.manage',
    contextTypes: ['platform'],
    icon: Settings,
    group: 'System',
  },
  {
    label: 'Dev Tools',
    to: '/app/dev-tools',
    permission: 'dev.tools.view',
    contextTypes: ['platform'],
    icon: Wrench,
    group: 'System',
  },
];
