import type { LucideIcon } from 'lucide-react';
import {
  Activity,
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
  Wrench,
  UserRoundSearch,
  Workflow,
} from 'lucide-react';

export type NavigationItem = {
  label: string;
  to: string;
  permission?: string | string[];
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

  { label: 'Public Timeline', to: '/app/public/timeline', permission: 'records.me.read', icon: Activity, group: 'Public' },
  { label: 'Doctor Registry', to: '/app/public/doctor-registry', permission: 'auth.me.read', icon: UserRoundSearch, group: 'Public' },

  { label: 'Provider Hub', to: '/app/provider/dashboard', permission: 'profile.search', icon: Building2, group: 'Provider' },
  { label: 'Patient Search', to: '/app/provider/patients', permission: 'profile.search', icon: Search, group: 'Provider' },
  { label: 'Encounters', to: '/app/provider/encounters', permission: 'encounters.read', icon: ClipboardList, group: 'Provider' },
  { label: 'Labs', to: '/app/provider/labs', permission: 'labs.read', icon: NotebookTabs, group: 'Provider' },
  { label: 'Pharmacy', to: '/app/provider/pharmacy', permission: 'pharmacy.read', icon: BuildingIcon, group: 'Provider' },

  { label: 'Taskforce', to: '/app/taskforce/dashboard', permission: 'governance.case.read', icon: ShieldAlert, group: 'Taskforce' },
  { label: 'Complaints', to: '/app/taskforce/complaints', permission: 'governance.case.read', icon: AlertOctagon, group: 'Taskforce' },
  { label: 'Case Management', to: '/app/taskforce/cases', permission: 'governance.case.read', icon: ClipboardList, group: 'Taskforce' },
  { label: 'Governance Audit', to: '/app/governance/audit', permission: 'audit.read', icon: NotebookTabs, group: 'Taskforce' },
  { label: 'Oversight', to: '/app/governance/oversight', permission: 'governance.case.read', icon: Scale, group: 'Taskforce' },

  { label: 'Emergency Inventory', to: '/app/emergency', permission: 'emergency.inventory.search', icon: Siren, group: 'Emergency' },
  { label: 'Emergency Cases', to: '/app/emergency/cases', permission: 'emergency.request.read', icon: AlertOctagon, group: 'Emergency' },
  { label: 'Notifications', to: '/app/notifications', permission: 'notifications.view', icon: ShieldCheck, group: 'Emergency' },
  { label: 'Alerts', to: '/app/alerts', permission: 'alerts.view', icon: AlertOctagon, group: 'Emergency' },

  { label: 'Analytics Dashboard', to: '/app/analytics/dashboard', permission: 'analytics.view', icon: BarChart3, group: 'Analytics' },
  { label: 'Health Metrics', to: '/app/analytics/metrics', permission: 'analytics.view', icon: Gauge, group: 'Analytics' },
  { label: 'Reports', to: '/app/reports', permission: 'reports.view', icon: FileSpreadsheet, group: 'Analytics' },

  { label: 'Data Quality', to: '/app/compliance/data-quality', permission: 'compliance.view', icon: SearchCheck, group: 'Compliance' },
  { label: 'Compliance Dashboard', to: '/app/compliance/dashboard', permission: 'compliance.view', icon: ShieldCheck, group: 'Compliance' },

  { label: 'Institution Dashboard', to: '/app/institution/dashboard', permission: 'institution.dashboard.view', icon: HeartPulse, group: 'Institution' },

  { label: 'Integrations', to: '/app/integrations', permission: 'integrations.view', icon: Link2, group: 'Integrations' },
  { label: 'API Keys', to: '/app/integrations/api-keys', permission: 'api.keys.manage', icon: KeyRound, group: 'Integrations' },
  { label: 'Sync Monitor', to: '/app/integrations/sync', permission: 'sync.monitor.view', icon: Workflow, group: 'Integrations' },

  { label: 'App Permissions', to: '/app/admin/access/app-permissions', permission: 'superadmin.only', icon: Shield, group: 'Administration' },
  { label: 'App Roles', to: '/app/admin/access/app-roles', permission: 'rbac.app.manage', icon: ShieldAlert, group: 'Administration' },
  { label: 'User Access', to: '/app/admin/access/users/self', permission: 'rbac.app.manage', icon: UserCog, group: 'Administration' },
  { label: 'Org Permissions', to: '/app/org/access/permissions', permission: 'rbac.org.manage', icon: Shield, group: 'Administration' },
  { label: 'Org Roles', to: '/app/org/access/roles', permission: 'rbac.org.manage', icon: ShieldAlert, group: 'Administration' },
  { label: 'Org Staff Access', to: '/app/org/access/staff/self', permission: 'rbac.org.manage', icon: UserCog, group: 'Administration' },
  { label: 'Admin Users', to: '/app/admin/users', permission: 'admin.users.manage', icon: UserCog, group: 'Administration' },
  { label: 'Admin Roles', to: '/app/admin/roles', permission: 'admin.roles.manage', icon: Shield, group: 'Administration' },
  { label: 'Admin Institutions', to: '/app/admin/institutions', permission: 'admin.institutions.manage', icon: Building2, group: 'Administration' },
  { label: 'Admin Settings', to: '/app/admin/system-settings', permission: 'admin.settings.manage', icon: Settings, group: 'Administration' },

  { label: 'System Activity', to: '/app/system/activity', permission: 'system.activity.view', icon: Activity, group: 'System' },
  { label: 'System Monitoring', to: '/app/system/monitoring', permission: 'system.monitoring.view', icon: Database, group: 'System' },
  { label: 'System Health', to: '/app/system/health', permission: 'system.health.view', icon: Gauge, group: 'System' },
  { label: 'Observability', to: '/app/system/observability', permission: 'system.observability.view', icon: Cog, group: 'System' },
  { label: 'System Config', to: '/app/system/configuration', permission: 'system.configuration.manage', icon: Settings, group: 'System' },
  { label: 'Dev Tools', to: '/app/dev-tools', permission: 'dev.tools.view', icon: Wrench, group: 'System' },
];
