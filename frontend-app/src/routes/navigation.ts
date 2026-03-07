import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  Search,
  Settings,
  ShieldAlert,
  Siren,
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
  { label: 'Taskforce', to: '/app/taskforce', permission: 'governance.case.read', icon: ShieldAlert },
  { label: 'Case Management', to: '/app/taskforce/cases', permission: 'governance.case.read', icon: ClipboardList },
  { label: 'Emergency', to: '/app/emergency', permission: 'emergency.request.read', icon: Siren },
  { label: 'Analytics', to: '/app/analytics', permission: 'analytics.read', icon: Gauge },
  { label: 'Settings', to: '/app/settings', icon: Settings },
];
