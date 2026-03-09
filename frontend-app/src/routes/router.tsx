import { Suspense, lazy, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/feedback/Spinner';
import { AppShell } from '@/layouts/AppShell';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { InterfaceAccessGate } from '@/routes/InterfaceAccessGate';
import { navigationItems } from '@/routes/navigation';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { getFirstAllowedNavigationPath } from '@/lib/navigationAccess';

const DashboardPage = lazy(async () => ({ default: (await import('@/modules/dashboard/pages/DashboardPage')).DashboardPage }));
const LoginPage = lazy(async () => ({ default: (await import('@/modules/auth/pages/LoginPage')).LoginPage }));
const SetPasswordPage = lazy(async () => ({ default: (await import('@/modules/auth/pages/SetPasswordPage')).SetPasswordPage }));
const TimelinePage = lazy(async () => ({ default: (await import('@/modules/public/timeline/TimelinePage')).TimelinePage }));
const DoctorRegistryPage = lazy(async () => ({ default: (await import('@/modules/public/doctor-registry/DoctorRegistryPage')).DoctorRegistryPage }));
const DoctorProfilePage = lazy(async () => ({ default: (await import('@/modules/public/doctor-registry/DoctorProfilePage')).DoctorProfilePage }));
const ProviderDashboardPage = lazy(async () => ({ default: (await import('@/modules/provider/dashboard/ProviderDashboardPage')).ProviderDashboardPage }));
const PatientSearchPage = lazy(async () => ({ default: (await import('@/modules/provider/patient-search/PatientSearchPage')).PatientSearchPage }));
const PatientProfilePage = lazy(async () => ({ default: (await import('@/modules/provider/patient-profile/PatientProfilePage')).PatientProfilePage }));
const EncountersListPage = lazy(async () => ({ default: (await import('@/modules/provider/encounters/EncountersListPage')).EncountersListPage }));
const EncounterDetailsPage = lazy(async () => ({ default: (await import('@/modules/provider/encounters/EncounterDetailsPage')).EncounterDetailsPage }));
const EncounterFormPage = lazy(async () => ({ default: (await import('@/modules/provider/encounters/EncounterFormPage')).EncounterFormPage }));
const LabsListPage = lazy(async () => ({ default: (await import('@/modules/provider/labs/LabsListPage')).LabsListPage }));
const LabRequestFormPage = lazy(async () => ({ default: (await import('@/modules/provider/labs/LabRequestFormPage')).LabRequestFormPage }));
const LabDetailsPage = lazy(async () => ({ default: (await import('@/modules/provider/labs/LabDetailsPage')).LabDetailsPage }));
const PharmacyListPage = lazy(async () => ({ default: (await import('@/modules/provider/pharmacy/PharmacyListPage')).PharmacyListPage }));
const PrescriptionFormPage = lazy(async () => ({ default: (await import('@/modules/provider/pharmacy/PrescriptionFormPage')).PrescriptionFormPage }));
const PharmacyDetailsPage = lazy(async () => ({ default: (await import('@/modules/provider/pharmacy/PharmacyDetailsPage')).PharmacyDetailsPage }));
const TaskforceDashboardPage = lazy(async () => ({ default: (await import('@/modules/taskforce/dashboard/TaskforceDashboardPage')).TaskforceDashboardPage }));
const ComplaintsListPage = lazy(async () => ({ default: (await import('@/modules/taskforce/complaints/ComplaintsListPage')).ComplaintsListPage }));
const ComplaintDetailsPage = lazy(async () => ({ default: (await import('@/modules/taskforce/complaints/ComplaintDetailsPage')).ComplaintDetailsPage }));
const CasesListPage = lazy(async () => ({ default: (await import('@/modules/taskforce/cases/CasesListPage')).CasesListPage }));
const CaseDetailsPage = lazy(async () => ({ default: (await import('@/modules/taskforce/cases/CaseDetailsPage')).CaseDetailsPage }));
const EmergencyInventoryPage = lazy(async () => ({ default: (await import('@/modules/emergency/EmergencyInventoryPage')).EmergencyInventoryPage }));
const EmergencyRequestPage = lazy(async () => ({ default: (await import('@/modules/emergency/EmergencyRequestPage')).EmergencyRequestPage }));
const EmergencyCasesListPage = lazy(async () => ({ default: (await import('@/modules/emergency/cases/EmergencyCasesListPage')).EmergencyCasesListPage }));
const EmergencyCaseDetailsPage = lazy(async () => ({ default: (await import('@/modules/emergency/cases/EmergencyCaseDetailsPage')).EmergencyCaseDetailsPage }));
const SettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/SettingsPage')).SettingsPage }));
const AppearanceSettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/AppearanceSettingsPage')).AppearanceSettingsPage }));
const BrandSettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/BrandSettingsPage')).BrandSettingsPage }));
const AccessibilitySettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/AccessibilitySettingsPage')).AccessibilitySettingsPage }));
const NotFoundPage = lazy(async () => ({ default: (await import('@/modules/dashboard/pages/NotFoundPage')).NotFoundPage }));
const UnauthorizedPage = lazy(async () => ({ default: (await import('@/modules/dashboard/pages/UnauthorizedPage')).UnauthorizedPage }));
const AuditPage = lazy(async () => ({ default: (await import('@/modules/governance/audit/AuditPage')).AuditPage }));
const OversightPage = lazy(async () => ({ default: (await import('@/modules/governance/audit/OversightPage')).OversightPage }));
const AppPermissionsPage = lazy(async () => ({ default: (await import('@/modules/admin/access/AppPermissionsPage')).AppPermissionsPage }));
const AppRolesPage = lazy(async () => ({ default: (await import('@/modules/admin/access/AppRolesPage')).AppRolesPage }));
const AppUserAccessPage = lazy(async () => ({ default: (await import('@/modules/admin/access/AppUserAccessPage')).AppUserAccessPage }));
const OrgPermissionsPage = lazy(async () => ({ default: (await import('@/modules/org/access/OrgPermissionsPage')).OrgPermissionsPage }));
const OrgRolesPage = lazy(async () => ({ default: (await import('@/modules/org/access/OrgRolesPage')).OrgRolesPage }));
const OrgStaffAccessPage = lazy(async () => ({ default: (await import('@/modules/org/access/OrgStaffAccessPage')).OrgStaffAccessPage }));
const AnalyticsDashboardPage = lazy(async () => ({ default: (await import('@/modules/analytics/dashboard/AnalyticsDashboardPage')).AnalyticsDashboardPage }));
const HealthMetricsPage = lazy(async () => ({ default: (await import('@/modules/analytics/metrics/HealthMetricsPage')).HealthMetricsPage }));
const ReportsPage = lazy(async () => ({ default: (await import('@/modules/reports/ReportsPage')).ReportsPage }));
const ReportDetailsPage = lazy(async () => ({ default: (await import('@/modules/reports/ReportDetailsPage')).ReportDetailsPage }));
const DataQualityPage = lazy(async () => ({ default: (await import('@/modules/compliance/data-quality/DataQualityPage')).DataQualityPage }));
const ComplianceDashboardPage = lazy(async () => ({ default: (await import('@/modules/compliance/dashboard/ComplianceDashboardPage')).ComplianceDashboardPage }));
const IntegrationsPage = lazy(async () => ({ default: (await import('@/modules/integrations/IntegrationsPage')).IntegrationsPage }));
const IntegrationDetailsPage = lazy(async () => ({ default: (await import('@/modules/integrations/IntegrationDetailsPage')).IntegrationDetailsPage }));
const ApiKeysPage = lazy(async () => ({ default: (await import('@/modules/integrations/api-keys/ApiKeysPage')).ApiKeysPage }));
const SyncMonitorPage = lazy(async () => ({ default: (await import('@/modules/integrations/sync/SyncMonitorPage')).SyncMonitorPage }));
const NotificationsListPage = lazy(async () => ({ default: (await import('@/modules/system/notifications/NotificationsListPage')).NotificationsListPage }));
const AlertsPage = lazy(async () => ({ default: (await import('@/modules/system/alerts/AlertsPage')).AlertsPage }));
const SystemActivityPage = lazy(async () => ({ default: (await import('@/modules/system/activity/SystemActivityPage')).SystemActivityPage }));
const SystemMonitoringPage = lazy(async () => ({ default: (await import('@/modules/system/monitoring/SystemMonitoringPage')).SystemMonitoringPage }));
const SystemConfigurationPage = lazy(async () => ({ default: (await import('@/modules/system/configuration/SystemConfigurationPage')).SystemConfigurationPage }));
const SystemObservabilityPage = lazy(async () => ({ default: (await import('@/modules/system/observability/SystemObservabilityPage')).SystemObservabilityPage }));
const SystemHealthPage = lazy(async () => ({ default: (await import('@/modules/system/health/SystemHealthPage')).SystemHealthPage }));
const DevToolsPage = lazy(async () => ({ default: (await import('@/modules/dev-tools/DevToolsPage')).DevToolsPage }));
const InstitutionDashboardPage = lazy(async () => ({ default: (await import('@/modules/institution/dashboard/InstitutionDashboardPage')).InstitutionDashboardPage }));
const AdminUsersPage = lazy(async () => ({ default: (await import('@/modules/admin/users/AdminUsersPage')).AdminUsersPage }));
const AdminRolesPage = lazy(async () => ({ default: (await import('@/modules/admin/roles/AdminRolesPage')).AdminRolesPage }));
const AdminInstitutionsPage = lazy(async () => ({ default: (await import('@/modules/admin/institutions/AdminInstitutionsPage')).AdminInstitutionsPage }));
const AdminSystemSettingsPage = lazy(async () => ({ default: (await import('@/modules/admin/system-settings/AdminSystemSettingsPage')).AdminSystemSettingsPage }));

function withSuspense(element: ReactElement) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-muted">
          <Spinner className="h-5 w-5" />
          <span className="ml-2 text-sm">Loading module...</span>
        </div>
      }
    >
      {element}
    </Suspense>
  );
}

function AccessFallback({ deniedPermission }: { deniedPermission?: string | string[] }) {
  const location = useLocation();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const hasAny = usePermissionsStore((state) => state.hasAny);
  const _permissionsVersion = usePermissionsStore((state) => state.version);
  void _permissionsVersion;

  const firstAllowedRoute = getFirstAllowedNavigationPath(navigationItems, hasPermission, hasAny);

  if (firstAllowedRoute && firstAllowedRoute !== location.pathname) {
    return <Navigate to={firstAllowedRoute} replace />;
  }

  return withSuspense(<UnauthorizedPage deniedPermission={deniedPermission} />);
}

function restricted(element: ReactElement, permission: string | string[]) {
  return (
    <InterfaceAccessGate permission={permission} fallback={<AccessFallback deniedPermission={permission} />}>
      <PermissionGate permission={permission} fallback={<AccessFallback deniedPermission={permission} />}>
        {withSuspense(element)}
      </PermissionGate>
    </InterfaceAccessGate>
  );
}

const brandAdminPermissions = ['ui.theme.write', 'rbac.org.manage', 'rbac.app.manage'];

export const appRouter = createBrowserRouter([
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/login', element: <Navigate to="/auth/login" replace /> },
  { path: '/auth/login', element: withSuspense(<LoginPage />) },
  {
    element: <ProtectedRoute allowPasswordSetup />,
    children: [{ path: '/auth/password/setup', element: withSuspense(<SetPasswordPage />) }],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/app',
        element: <AppShell />,
        children: [
          { index: true, element: restricted(<DashboardPage />, 'auth.me.read') },
          { path: 'public/timeline', element: restricted(<TimelinePage />, 'records.me.read') },
          { path: 'public/doctor-registry', element: restricted(<DoctorRegistryPage />, 'auth.me.read') },
          { path: 'public/doctor-registry/:doctorId', element: restricted(<DoctorProfilePage />, 'doctor.read') },
          { path: 'provider', element: <Navigate to="/app/provider/dashboard" replace /> },
          { path: 'provider/dashboard', element: restricted(<ProviderDashboardPage />, 'profile.search') },
          { path: 'provider/patients', element: restricted(<PatientSearchPage />, 'profile.search') },
          { path: 'provider/patient/:nin', element: restricted(<PatientProfilePage />, 'profile.user.read') },
          { path: 'provider/encounters', element: restricted(<EncountersListPage />, 'encounters.read') },
          { path: 'provider/encounters/new', element: restricted(<EncounterFormPage />, 'encounters.create') },
          { path: 'provider/encounters/:id', element: restricted(<EncounterDetailsPage />, 'encounters.read') },
          { path: 'provider/encounters/:id/edit', element: restricted(<EncounterFormPage />, 'encounters.update') },
          { path: 'provider/patient/:nin/encounters/new', element: restricted(<EncounterFormPage />, 'encounters.create') },
          { path: 'provider/labs', element: restricted(<LabsListPage />, 'labs.read') },
          { path: 'provider/labs/new', element: restricted(<LabRequestFormPage />, 'labs.create') },
          { path: 'provider/labs/:id', element: restricted(<LabDetailsPage />, 'labs.read') },
          { path: 'provider/labs/:id/edit', element: restricted(<LabDetailsPage />, 'labs.update') },
          { path: 'provider/patient/:nin/labs/new', element: restricted(<LabRequestFormPage />, 'labs.create') },
          { path: 'provider/pharmacy', element: restricted(<PharmacyListPage />, 'pharmacy.read') },
          { path: 'provider/pharmacy/new', element: restricted(<PrescriptionFormPage />, 'pharmacy.create') },
          { path: 'provider/pharmacy/:id', element: restricted(<PharmacyDetailsPage />, 'pharmacy.read') },
          { path: 'provider/pharmacy/:id/edit', element: restricted(<PharmacyDetailsPage />, 'pharmacy.update') },
          { path: 'provider/patient/:nin/pharmacy/new', element: restricted(<PrescriptionFormPage />, 'pharmacy.create') },
          { path: 'taskforce', element: <Navigate to="/app/taskforce/dashboard" replace /> },
          { path: 'taskforce/dashboard', element: restricted(<TaskforceDashboardPage />, 'governance.case.read') },
          { path: 'taskforce/complaints', element: restricted(<ComplaintsListPage />, 'governance.case.read') },
          { path: 'taskforce/complaints/:id', element: restricted(<ComplaintDetailsPage />, 'governance.case.read') },
          { path: 'taskforce/cases', element: restricted(<CasesListPage />, 'governance.case.read') },
          { path: 'taskforce/cases/:id', element: restricted(<CaseDetailsPage />, 'governance.case.read') },
          { path: 'governance/audit', element: restricted(<AuditPage />, 'audit.read') },
          { path: 'governance/oversight', element: restricted(<OversightPage />, 'governance.case.read') },
          { path: 'emergency', element: restricted(<EmergencyInventoryPage />, 'emergency.inventory.search') },
          { path: 'emergency/request', element: restricted(<EmergencyRequestPage />, 'emergency.request.create') },
          { path: 'emergency/cases', element: restricted(<EmergencyCasesListPage />, 'emergency.request.read') },
          { path: 'emergency/cases/:id', element: restricted(<EmergencyCaseDetailsPage />, 'emergency.request.read') },
          { path: 'notifications', element: restricted(<NotificationsListPage />, 'notifications.view') },
          { path: 'alerts', element: restricted(<AlertsPage />, 'alerts.view') },
          { path: 'analytics/dashboard', element: restricted(<AnalyticsDashboardPage />, 'analytics.view') },
          { path: 'analytics/metrics', element: restricted(<HealthMetricsPage />, 'analytics.view') },
          { path: 'reports', element: restricted(<ReportsPage />, 'reports.view') },
          { path: 'reports/:reportId', element: restricted(<ReportDetailsPage />, 'reports.view') },
          { path: 'compliance/data-quality', element: restricted(<DataQualityPage />, 'compliance.view') },
          { path: 'compliance/dashboard', element: restricted(<ComplianceDashboardPage />, 'compliance.view') },
          { path: 'integrations', element: restricted(<IntegrationsPage />, 'integrations.view') },
          { path: 'integrations/:id', element: restricted(<IntegrationDetailsPage />, 'integrations.view') },
          { path: 'integrations/api-keys', element: restricted(<ApiKeysPage />, 'api.keys.manage') },
          { path: 'integrations/sync', element: restricted(<SyncMonitorPage />, 'sync.monitor.view') },
          { path: 'institution/dashboard', element: restricted(<InstitutionDashboardPage />, 'institution.dashboard.view') },
          { path: 'system/activity', element: restricted(<SystemActivityPage />, 'system.activity.view') },
          { path: 'system/monitoring', element: restricted(<SystemMonitoringPage />, 'system.monitoring.view') },
          { path: 'system/configuration', element: restricted(<SystemConfigurationPage />, 'system.configuration.manage') },
          { path: 'system/observability', element: restricted(<SystemObservabilityPage />, 'system.observability.view') },
          { path: 'system/health', element: restricted(<SystemHealthPage />, 'system.health.view') },
          { path: 'dev-tools', element: restricted(<DevToolsPage />, 'dev.tools.view') },
          { path: 'admin/access/app-permissions', element: restricted(<AppPermissionsPage />, 'superadmin.only') },
          { path: 'admin/access/app-roles', element: restricted(<AppRolesPage />, 'rbac.app.manage') },
          { path: 'admin/access/users/:userId', element: restricted(<AppUserAccessPage />, 'rbac.app.manage') },
          { path: 'admin/users', element: restricted(<AdminUsersPage />, 'admin.users.manage') },
          { path: 'admin/roles', element: restricted(<AdminRolesPage />, 'admin.roles.manage') },
          { path: 'admin/institutions', element: restricted(<AdminInstitutionsPage />, 'admin.institutions.manage') },
          { path: 'admin/system-settings', element: restricted(<AdminSystemSettingsPage />, 'admin.settings.manage') },
          { path: 'org/access/permissions', element: restricted(<OrgPermissionsPage />, 'rbac.org.manage') },
          { path: 'org/access/roles', element: restricted(<OrgRolesPage />, 'rbac.org.manage') },
          { path: 'org/access/staff/:userId', element: restricted(<OrgStaffAccessPage />, 'rbac.org.manage') },
          { path: 'settings', element: restricted(<SettingsPage />, 'auth.me.read') },
          { path: 'settings/appearance', element: restricted(<AppearanceSettingsPage />, 'auth.me.read') },
          { path: 'settings/brand', element: restricted(<BrandSettingsPage />, brandAdminPermissions) },
          { path: 'settings/accessibility', element: restricted(<AccessibilitySettingsPage />, 'auth.me.read') },
          { path: 'unauthorized', element: withSuspense(<UnauthorizedPage />) },
        ],
      },
    ],
  },
  { path: '/unauthorized', element: <Navigate to="/app/unauthorized" replace /> },
  { path: '*', element: withSuspense(<NotFoundPage />) },
]);
