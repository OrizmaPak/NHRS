import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppShell } from '@/layouts/AppShell';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { DashboardPage } from '@/modules/dashboard/pages/DashboardPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { TimelinePage } from '@/modules/public/timeline/TimelinePage';
import { DoctorRegistryPage } from '@/modules/public/doctor-registry/DoctorRegistryPage';
import { DoctorProfilePage } from '@/modules/public/doctor-registry/DoctorProfilePage';
import { ProviderDashboardPage } from '@/modules/provider/dashboard/ProviderDashboardPage';
import { PatientSearchPage } from '@/modules/provider/patient-search/PatientSearchPage';
import { PatientProfilePage } from '@/modules/provider/patient-profile/PatientProfilePage';
import { TaskforceDashboardPage } from '@/modules/taskforce/pages/TaskforceDashboardPage';
import { ComplaintsPage } from '@/modules/taskforce/pages/ComplaintsPage';
import { EmergencyInventoryPage } from '@/modules/emergency/EmergencyInventoryPage';
import { EmergencyRequestPage } from '@/modules/emergency/EmergencyRequestPage';
import { SettingsPage } from '@/modules/settings/pages/SettingsPage';
import { AppearanceSettingsPage } from '@/modules/settings/pages/AppearanceSettingsPage';
import { BrandSettingsPage } from '@/modules/settings/pages/BrandSettingsPage';
import { AccessibilitySettingsPage } from '@/modules/settings/pages/AccessibilitySettingsPage';
import { NotFoundPage } from '@/modules/dashboard/pages/NotFoundPage';
import { AnalyticsPage } from '@/modules/dashboard/pages/AnalyticsPage';
import { UnauthorizedPage } from '@/modules/dashboard/pages/UnauthorizedPage';

function restricted(element: ReactElement, permission: string | string[]) {
  return <PermissionGate permission={permission} fallback={<UnauthorizedPage />}>{element}</PermissionGate>;
}

const brandAdminPermissions = ['ui.theme.update', 'organization.admin', 'state.admin', 'taskforce.admin'];

export const appRouter = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/app" replace />,
  },
  {
    path: '/login',
    element: <Navigate to="/auth/login" replace />,
  },
  {
    path: '/auth/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/app',
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'public/timeline', element: restricted(<TimelinePage />, 'records.me.read') },
          { path: 'public/doctor-registry', element: restricted(<DoctorRegistryPage />, 'doctor.registry.read') },
          { path: 'public/doctor-registry/:doctorId', element: restricted(<DoctorProfilePage />, 'doctor.registry.read') },
          { path: 'provider', element: <Navigate to="/app/provider/dashboard" replace /> },
          { path: 'provider/dashboard', element: restricted(<ProviderDashboardPage />, 'provider.patient.read') },
          { path: 'provider/patients', element: restricted(<PatientSearchPage />, 'provider.patient.read') },
          { path: 'provider/patient/:nin', element: restricted(<PatientProfilePage />, 'provider.patient.read') },
          { path: 'taskforce', element: restricted(<TaskforceDashboardPage />, 'governance.case.read') },
          { path: 'taskforce/cases', element: restricted(<ComplaintsPage />, 'governance.case.read') },
          { path: 'emergency', element: restricted(<EmergencyInventoryPage />, 'emergency.request.read') },
          { path: 'emergency/request', element: restricted(<EmergencyRequestPage />, 'emergency.request.create') },
          { path: 'analytics', element: restricted(<AnalyticsPage />, 'analytics.read') },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'settings/appearance', element: <AppearanceSettingsPage /> },
          {
            path: 'settings/brand',
            element: restricted(<BrandSettingsPage />, brandAdminPermissions),
          },
          { path: 'settings/accessibility', element: <AccessibilitySettingsPage /> },
        ],
      },
    ],
  },
  {
    path: '/unauthorized',
    element: <UnauthorizedPage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
