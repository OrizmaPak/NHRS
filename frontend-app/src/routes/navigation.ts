import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertOctagon,
  Building2,
  BuildingIcon,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  NotebookTabs,
  Search,
  Settings,
  ShieldAlert,
  Siren,
  Scale,
  UserRoundSearch,
} from 'lucide-react';

export type NavigationItem = {
  label: string;
  to: string;
  permission?: string;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', to: '/app', permission: 'dashboard.read', icon: LayoutDashboard },
  { label: 'Public Timeline', to: '/app/public/timeline', icon: Activity },
  { label: 'Doctor Registry', to: '/app/public/doctor-registry', permission: 'doctor.registry.read', icon: UserRoundSearch },
  { label: 'Provider Hub', to: '/app/provider/dashboard', permission: 'provider.patient.read', icon: Building2 },
  { label: 'Patient Search', to: '/app/provider/patients', permission: 'provider.patient.read', icon: Search },
  { label: 'Taskforce', to: '/app/taskforce/dashboard', permission: 'cases.view', icon: ShieldAlert },
  { label: 'Complaints', to: '/app/taskforce/complaints', permission: 'complaints.view', icon: AlertOctagon },
  { label: 'Case Management', to: '/app/taskforce/cases', permission: 'cases.view', icon: ClipboardList },
  { label: 'Governance Audit', to: '/app/governance/audit', permission: 'audit.view', icon: NotebookTabs },
  { label: 'Oversight', to: '/app/governance/oversight', permission: 'oversight.view', icon: Scale },
  { label: 'Emergency', to: '/app/emergency', permission: 'emergency.request.read', icon: Siren },
  { label: 'Analytics', to: '/app/analytics', permission: 'analytics.read', icon: Gauge },
  { label: 'Institutions', to: '/app/provider/dashboard', permission: 'provider.patient.read', icon: BuildingIcon },
  { label: 'Settings', to: '/app/settings', icon: Settings },
];
