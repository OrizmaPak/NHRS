import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertOctagon,
  Building2,
  BuildingIcon,
  ClipboardList,
  LayoutDashboard,
  NotebookTabs,
  Search,
  UserCog,
  Shield,
  Settings,
  ShieldAlert,
  Siren,
  Scale,
  UserRoundSearch,
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
    | 'Administration'
    | 'System';
};

export const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', to: '/app', icon: LayoutDashboard, group: 'Core' },
  { label: 'Settings', to: '/app/settings', icon: Settings, group: 'Core' },

  { label: 'Public Timeline', to: '/app/public/timeline', icon: Activity, group: 'Public' },
  { label: 'Doctor Registry', to: '/app/public/doctor-registry', icon: UserRoundSearch, group: 'Public' },

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

  { label: 'App Permissions', to: '/app/admin/access/app-permissions', permission: 'superadmin.only', icon: Shield, group: 'Administration' },
  { label: 'App Roles', to: '/app/admin/access/app-roles', permission: 'rbac.app.manage', icon: ShieldAlert, group: 'Administration' },
  { label: 'User Access', to: '/app/admin/access/users/self', permission: 'rbac.app.manage', icon: UserCog, group: 'Administration' },
  { label: 'Org Permissions', to: '/app/org/access/permissions', permission: 'rbac.org.manage', icon: Shield, group: 'Administration' },
  { label: 'Org Roles', to: '/app/org/access/roles', permission: 'rbac.org.manage', icon: ShieldAlert, group: 'Administration' },
  { label: 'Org Staff Access', to: '/app/org/access/staff/self', permission: 'rbac.org.manage', icon: UserCog, group: 'Administration' },
];
