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
import { EncountersListPage } from '@/modules/provider/encounters/EncountersListPage';
import { EncounterDetailsPage } from '@/modules/provider/encounters/EncounterDetailsPage';
import { EncounterFormPage } from '@/modules/provider/encounters/EncounterFormPage';
import { LabsListPage } from '@/modules/provider/labs/LabsListPage';
import { LabRequestFormPage } from '@/modules/provider/labs/LabRequestFormPage';
import { LabDetailsPage } from '@/modules/provider/labs/LabDetailsPage';
import { PharmacyListPage } from '@/modules/provider/pharmacy/PharmacyListPage';
import { PrescriptionFormPage } from '@/modules/provider/pharmacy/PrescriptionFormPage';
import { PharmacyDetailsPage } from '@/modules/provider/pharmacy/PharmacyDetailsPage';
import { TaskforceDashboardPage } from '@/modules/taskforce/dashboard/TaskforceDashboardPage';
import { ComplaintsListPage } from '@/modules/taskforce/complaints/ComplaintsListPage';
import { ComplaintDetailsPage } from '@/modules/taskforce/complaints/ComplaintDetailsPage';
import { CasesListPage } from '@/modules/taskforce/cases/CasesListPage';
import { CaseDetailsPage } from '@/modules/taskforce/cases/CaseDetailsPage';
import { EmergencyInventoryPage } from '@/modules/emergency/EmergencyInventoryPage';
import { EmergencyRequestPage } from '@/modules/emergency/EmergencyRequestPage';
import { SettingsPage } from '@/modules/settings/pages/SettingsPage';
import { AppearanceSettingsPage } from '@/modules/settings/pages/AppearanceSettingsPage';
import { BrandSettingsPage } from '@/modules/settings/pages/BrandSettingsPage';
import { AccessibilitySettingsPage } from '@/modules/settings/pages/AccessibilitySettingsPage';
import { NotFoundPage } from '@/modules/dashboard/pages/NotFoundPage';
import { AnalyticsPage } from '@/modules/dashboard/pages/AnalyticsPage';
import { UnauthorizedPage } from '@/modules/dashboard/pages/UnauthorizedPage';
import { AuditPage } from '@/modules/governance/audit/AuditPage';
import { OversightPage } from '@/modules/governance/audit/OversightPage';

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
          { path: 'public/timeline', element: <TimelinePage /> },
          { path: 'public/doctor-registry', element: restricted(<DoctorRegistryPage />, 'doctor.registry.read') },
          { path: 'public/doctor-registry/:doctorId', element: restricted(<DoctorProfilePage />, 'doctor.registry.read') },
          { path: 'provider', element: <Navigate to="/app/provider/dashboard" replace /> },
          { path: 'provider/dashboard', element: restricted(<ProviderDashboardPage />, 'provider.patient.read') },
          { path: 'provider/patients', element: restricted(<PatientSearchPage />, 'provider.patient.read') },
          { path: 'provider/patient/:nin', element: restricted(<PatientProfilePage />, 'provider.patient.read') },
          { path: 'provider/encounters', element: restricted(<EncountersListPage />, 'encounters.view') },
          { path: 'provider/encounters/new', element: restricted(<EncounterFormPage />, 'encounters.create') },
          { path: 'provider/encounters/:id', element: restricted(<EncounterDetailsPage />, 'encounters.view') },
          { path: 'provider/encounters/:id/edit', element: restricted(<EncounterFormPage />, 'encounters.update') },
          { path: 'provider/patient/:nin/encounters/new', element: restricted(<EncounterFormPage />, 'encounters.create') },
          { path: 'provider/labs', element: restricted(<LabsListPage />, 'labs.view') },
          { path: 'provider/labs/new', element: restricted(<LabRequestFormPage />, 'labs.create') },
          { path: 'provider/labs/:id', element: restricted(<LabDetailsPage />, 'labs.view') },
          { path: 'provider/labs/:id/edit', element: restricted(<LabDetailsPage />, 'labs.update') },
          { path: 'provider/patient/:nin/labs/new', element: restricted(<LabRequestFormPage />, 'labs.create') },
          { path: 'provider/pharmacy', element: restricted(<PharmacyListPage />, 'pharmacy.view') },
          { path: 'provider/pharmacy/new', element: restricted(<PrescriptionFormPage />, 'pharmacy.create') },
          { path: 'provider/pharmacy/:id', element: restricted(<PharmacyDetailsPage />, 'pharmacy.view') },
          { path: 'provider/pharmacy/:id/edit', element: restricted(<PharmacyDetailsPage />, 'pharmacy.update') },
          { path: 'provider/patient/:nin/pharmacy/new', element: restricted(<PrescriptionFormPage />, 'pharmacy.create') },
          { path: 'taskforce', element: <Navigate to="/app/taskforce/dashboard" replace /> },
          { path: 'taskforce/dashboard', element: restricted(<TaskforceDashboardPage />, 'cases.view') },
          { path: 'taskforce/complaints', element: restricted(<ComplaintsListPage />, 'complaints.view') },
          { path: 'taskforce/complaints/:id', element: restricted(<ComplaintDetailsPage />, 'complaints.view') },
          { path: 'taskforce/cases', element: restricted(<CasesListPage />, 'cases.view') },
          { path: 'taskforce/cases/:id', element: restricted(<CaseDetailsPage />, 'cases.view') },
          { path: 'governance/audit', element: restricted(<AuditPage />, 'audit.view') },
          { path: 'governance/oversight', element: restricted(<OversightPage />, 'oversight.view') },
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
