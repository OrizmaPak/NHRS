import { Suspense, lazy, type ReactElement } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/feedback/Spinner';
import { AppShell } from '@/layouts/AppShell';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { InterfaceAccessGate } from '@/routes/InterfaceAccessGate';
import { navigationItems } from '@/routes/navigation';
import { useContextStore } from '@/stores/contextStore';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { getFirstAllowedNavigationPath, isNavigationItemVisibleInContext } from '@/lib/navigationAccess';
import { getOrganizationScopeKind, type OrganizationScopeKind } from '@/lib/organizationContext';

const DashboardPage = lazy(async () => ({ default: (await import('@/modules/dashboard/pages/DashboardPage')).DashboardPage }));
const LoginPage = lazy(async () => ({ default: (await import('@/modules/auth/pages/LoginPage')).LoginPage }));
const SetPasswordPage = lazy(async () => ({ default: (await import('@/modules/auth/pages/SetPasswordPage')).SetPasswordPage }));
const TimelinePage = lazy(async () => ({ default: (await import('@/modules/public/timeline/TimelinePage')).TimelinePage }));
const OrganizationsDirectoryPage = lazy(async () => ({ default: (await import('@/modules/public/organizations/OrganizationsDirectoryPage')).OrganizationsDirectoryPage }));
const OrganizationPublicDetailsPage = lazy(async () => ({ default: (await import('@/modules/public/organizations/OrganizationPublicDetailsPage')).OrganizationPublicDetailsPage }));
const DoctorRegistryPage = lazy(async () => ({ default: (await import('@/modules/public/doctor-registry/DoctorRegistryPage')).DoctorRegistryPage }));
const DoctorProfilePage = lazy(async () => ({ default: (await import('@/modules/public/doctor-registry/DoctorProfilePage')).DoctorProfilePage }));
const ProviderDashboardPage = lazy(async () => ({ default: (await import('@/modules/provider/dashboard/ProviderDashboardPage')).ProviderDashboardPage }));
const PatientCareWorkspacePage = lazy(async () => ({ default: (await import('@/modules/provider/dashboard/PatientCareWorkspacePage')).PatientCareWorkspacePage }));
const PatientSearchPage = lazy(async () => ({ default: (await import('@/modules/provider/patient-search/PatientSearchPage')).PatientSearchPage }));
const PatientIntakePage = lazy(async () => ({ default: (await import('@/modules/provider/patient-intake/PatientIntakePage')).PatientIntakePage }));
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
const MyProfileSettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/MyProfileSettingsPage')).MyProfileSettingsPage }));
const AppearanceSettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/AppearanceSettingsPage')).AppearanceSettingsPage }));
const BrandSettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/BrandSettingsPage')).BrandSettingsPage }));
const AccessibilitySettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/AccessibilitySettingsPage')).AccessibilitySettingsPage }));
const UserSettingsPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/UserSettingsPage')).UserSettingsPage }));
const GlobalServicesPage = lazy(async () => ({ default: (await import('@/modules/settings/pages/GlobalServicesPage')).GlobalServicesPage }));
const NotFoundPage = lazy(async () => ({ default: (await import('@/modules/dashboard/pages/NotFoundPage')).NotFoundPage }));
const UnauthorizedPage = lazy(async () => ({ default: (await import('@/modules/dashboard/pages/UnauthorizedPage')).UnauthorizedPage }));
const AuditPage = lazy(async () => ({ default: (await import('@/modules/governance/audit/AuditPage')).AuditPage }));
const OversightPage = lazy(async () => ({ default: (await import('@/modules/governance/audit/OversightPage')).OversightPage }));
const AppPermissionsPage = lazy(async () => ({ default: (await import('@/modules/admin/access/AppPermissionsPage')).AppPermissionsPage }));
const AppRolesPage = lazy(async () => ({ default: (await import('@/modules/admin/access/AppRolesPage')).AppRolesPage }));
const AppUserAccessPage = lazy(async () => ({ default: (await import('@/modules/admin/access/AppUserAccessPage')).AppUserAccessPage }));
const GeoMappingPage = lazy(async () => ({ default: (await import('@/modules/admin/geography/GeoMappingPage')).GeoMappingPage }));
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
const AdminSystemSettingsPage = lazy(async () => ({ default: (await import('@/modules/admin/system-settings/AdminSystemSettingsPage')).AdminSystemSettingsPage }));
const OrganizationsPage = lazy(async () => ({ default: (await import('@/modules/organization/organizations/OrganizationsPage')).OrganizationsPage }));
const OrganizationApprovalsPage = lazy(async () => ({ default: (await import('@/modules/organization/organizations/OrganizationApprovalsPage')).OrganizationApprovalsPage }));
const OrganizationDetailsPage = lazy(async () => ({ default: (await import('@/modules/organization/organizations/OrganizationDetailsPage')).OrganizationDetailsPage }));
const DeletedOrganizationsPage = lazy(async () => ({ default: (await import('@/modules/organization/organizations/DeletedOrganizationsPage')).DeletedOrganizationsPage }));
const OrganizationStaffPage = lazy(async () => ({ default: (await import('@/modules/organization/organizations/OrganizationStaffPage')).OrganizationStaffPage }));
const InstitutionsPage = lazy(async () => ({ default: (await import('@/modules/organization/institutions/InstitutionsPage')).InstitutionsPage }));
const InstitutionDetailsPage = lazy(async () => ({ default: (await import('@/modules/organization/institutions/InstitutionDetailsPage')).InstitutionDetailsPage }));
const InstitutionStaffPage = lazy(async () => ({ default: (await import('@/modules/organization/institutions/InstitutionStaffPage')).InstitutionStaffPage }));
const BranchesPage = lazy(async () => ({ default: (await import('@/modules/organization/branches/BranchesPage')).BranchesPage }));
const BranchDetailsPage = lazy(async () => ({ default: (await import('@/modules/organization/branches/BranchDetailsPage')).BranchDetailsPage }));
const BranchStaffPage = lazy(async () => ({ default: (await import('@/modules/organization/branches/BranchStaffPage')).BranchStaffPage }));

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
  const activeContext = useContextStore((state) => state.activeContext);

  const firstAllowedRoute = getFirstAllowedNavigationPath(navigationItems, hasPermission, hasAny, activeContext);

  if (firstAllowedRoute && firstAllowedRoute !== location.pathname) {
    return <Navigate to={firstAllowedRoute} replace />;
  }

  return withSuspense(<UnauthorizedPage deniedPermission={deniedPermission} />);
}

function AppEntryRoute() {
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const hasAny = usePermissionsStore((state) => state.hasAny);
  const _permissionsVersion = usePermissionsStore((state) => state.version);
  void _permissionsVersion;
  const activeContext = useContextStore((state) => state.activeContext);

  const firstAllowedByResolved = getFirstAllowedNavigationPath(navigationItems, hasPermission, hasAny, activeContext);
  const contextPermissions = new Set(Array.isArray(activeContext?.permissions) ? activeContext.permissions : []);
  const hasContextPermission = (permission: string) => contextPermissions.has('*') || contextPermissions.has(permission);
  const hasContextAny = (permissions: string[]) => permissions.some((permission) => hasContextPermission(permission));
  const firstAllowedByContext = getFirstAllowedNavigationPath(navigationItems, hasContextPermission, hasContextAny, activeContext);

  const target = firstAllowedByResolved ?? firstAllowedByContext;
  if (target === '/app') {
    return withSuspense(<DashboardPage />);
  }
  if (target) {
    return <Navigate to={target} replace />;
  }
  return withSuspense(<UnauthorizedPage deniedPermission="No permitted interface for active context" />);
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

function contextRestricted(
  element: ReactElement,
  permission: string | string[],
  allowedContextTypes: Array<'public' | 'platform' | 'organization' | 'state' | 'taskforce'>,
  allowedOrganizationScopes?: OrganizationScopeKind[],
) {
  return (
    <ContextTypeGate allowed={allowedContextTypes} allowedOrganizationScopes={allowedOrganizationScopes}>
      {restricted(element, permission)}
    </ContextTypeGate>
  );
}

function ContextTypeGate({
  allowed,
  allowedOrganizationScopes,
  children,
}: {
  allowed: Array<'public' | 'platform' | 'organization' | 'state' | 'taskforce'>;
  allowedOrganizationScopes?: OrganizationScopeKind[];
  children: ReactElement;
}) {
  const location = useLocation();
  const activeContext = useContextStore((state) => state.activeContext);
  if (!activeContext || !allowed.includes(activeContext.type)) {
    return <AccessFallback deniedPermission={`Context required: ${allowed.join(' | ')}`} />;
  }

  if (activeContext.type === 'organization' && allowedOrganizationScopes?.length) {
    const scopeKind = getOrganizationScopeKind(activeContext);
    if (!scopeKind || !allowedOrganizationScopes.includes(scopeKind)) {
      return <AccessFallback deniedPermission={`Scope required: ${allowedOrganizationScopes.join(' | ')}`} />;
    }
  }

  const navEntry = navigationItems.find((item) => item.to === location.pathname);
  if (navEntry && !isNavigationItemVisibleInContext(navEntry, activeContext)) {
    return <AccessFallback deniedPermission="Interface unavailable in current context" />;
  }

  return children;
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
          { index: true, element: <AppEntryRoute /> },
          { path: 'public/timeline', element: contextRestricted(<TimelinePage />, 'records.me.read', ['public']) },
          { path: 'public/organizations', element: withSuspense(<OrganizationsDirectoryPage />) },
          { path: 'public/organizations/:orgId', element: withSuspense(<OrganizationPublicDetailsPage />) },
          { path: 'public/doctor-registry', element: restricted(<DoctorRegistryPage />, 'doctor.search') },
          { path: 'public/doctor-registry/:doctorId', element: restricted(<DoctorProfilePage />, 'doctor.read') },
          { path: 'provider', element: <Navigate to="/app/provider/dashboard" replace /> },
          { path: 'provider/dashboard', element: contextRestricted(<ProviderDashboardPage />, 'profile.search', ['platform', 'organization']) },
          { path: 'provider/patients', element: contextRestricted(<PatientSearchPage />, 'profile.search', ['platform', 'organization']) },
          { path: 'provider/intake', element: contextRestricted(<PatientIntakePage />, 'profile.placeholder.create', ['organization']) },
          { path: 'provider/patient/:nin', element: contextRestricted(<PatientProfilePage />, 'profile.user.read', ['platform', 'organization']) },
          { path: 'care', element: contextRestricted(<PatientCareWorkspacePage />, 'care.workspace.read', ['organization']) },
          { path: 'care/patients', element: contextRestricted(<PatientSearchPage />, 'profile.search', ['organization']) },
          { path: 'care/intake', element: contextRestricted(<PatientIntakePage />, 'profile.placeholder.create', ['organization']) },
          { path: 'care/patient/:nin', element: contextRestricted(<PatientProfilePage />, 'profile.user.read', ['organization']) },
          { path: 'provider/encounters', element: contextRestricted(<EncountersListPage />, 'encounters.read', ['platform', 'organization']) },
          { path: 'provider/encounters/new', element: contextRestricted(<EncounterFormPage />, 'encounters.create', ['platform', 'organization']) },
          { path: 'provider/encounters/:id', element: contextRestricted(<EncounterDetailsPage />, 'encounters.read', ['platform', 'organization']) },
          { path: 'provider/encounters/:id/edit', element: contextRestricted(<EncounterFormPage />, 'encounters.update', ['platform', 'organization']) },
          { path: 'provider/patient/:nin/encounters/new', element: contextRestricted(<EncounterFormPage />, 'encounters.create', ['platform', 'organization']) },
          { path: 'provider/labs', element: contextRestricted(<LabsListPage />, 'labs.read', ['platform', 'organization']) },
          { path: 'provider/labs/new', element: contextRestricted(<LabRequestFormPage />, 'labs.create', ['platform', 'organization']) },
          { path: 'provider/labs/:id', element: contextRestricted(<LabDetailsPage />, 'labs.read', ['platform', 'organization']) },
          { path: 'provider/labs/:id/edit', element: contextRestricted(<LabDetailsPage />, 'labs.update', ['platform', 'organization']) },
          { path: 'provider/patient/:nin/labs/new', element: contextRestricted(<LabRequestFormPage />, 'labs.create', ['platform', 'organization']) },
          { path: 'provider/pharmacy', element: contextRestricted(<PharmacyListPage />, 'pharmacy.read', ['platform', 'organization']) },
          { path: 'provider/pharmacy/new', element: contextRestricted(<PrescriptionFormPage />, 'pharmacy.create', ['platform', 'organization']) },
          { path: 'provider/pharmacy/:id', element: contextRestricted(<PharmacyDetailsPage />, 'pharmacy.read', ['platform', 'organization']) },
          { path: 'provider/pharmacy/:id/edit', element: contextRestricted(<PharmacyDetailsPage />, 'pharmacy.update', ['platform', 'organization']) },
          { path: 'provider/patient/:nin/pharmacy/new', element: contextRestricted(<PrescriptionFormPage />, 'pharmacy.create', ['platform', 'organization']) },
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
          { path: 'organizations', element: contextRestricted(<OrganizationsPage />, ['org.list', 'org.read'], ['platform', 'organization']) },
          { path: 'organizations/approvals', element: contextRestricted(<OrganizationApprovalsPage />, 'org.update', ['platform']) },
          { path: 'organizations/deleted', element: contextRestricted(<DeletedOrganizationsPage />, 'org.deleted.read', ['platform']) },
          { path: 'organizations/:orgId', element: restricted(<OrganizationDetailsPage />, ['org.read', 'org.list']) },
          { path: 'organizations/:orgId/staff', element: contextRestricted(<OrganizationStaffPage />, 'org.member.read', ['organization']) },
          { path: 'institutions', element: contextRestricted(<InstitutionsPage />, 'org.list', ['organization']) },
          { path: 'institutions/:institutionId', element: contextRestricted(<InstitutionDetailsPage />, 'org.read', ['organization']) },
          { path: 'institutions/:institutionId/staff', element: contextRestricted(<InstitutionStaffPage />, 'org.member.read', ['organization']) },
          { path: 'branches', element: contextRestricted(<BranchesPage />, 'org.list', ['organization']) },
          { path: 'branches/:branchId', element: contextRestricted(<BranchDetailsPage />, 'org.read', ['organization']) },
          { path: 'branches/:branchId/staff', element: contextRestricted(<BranchStaffPage />, 'org.member.read', ['organization']) },
          { path: 'system/activity', element: contextRestricted(<SystemActivityPage />, 'system.activity.view', ['platform']) },
          { path: 'system/monitoring', element: contextRestricted(<SystemMonitoringPage />, 'system.monitoring.view', ['platform']) },
          { path: 'system/configuration', element: contextRestricted(<SystemConfigurationPage />, 'system.configuration.manage', ['platform']) },
          { path: 'system/observability', element: contextRestricted(<SystemObservabilityPage />, 'system.observability.view', ['platform']) },
          { path: 'system/health', element: contextRestricted(<SystemHealthPage />, 'system.health.view', ['platform']) },
          { path: 'dev-tools', element: contextRestricted(<DevToolsPage />, 'dev.tools.view', ['platform']) },
          { path: 'admin/access/app-permissions', element: restricted(<AppPermissionsPage />, ['rbac.app.manage', 'superadmin.only']) },
          { path: 'admin/access/app-roles', element: restricted(<AppRolesPage />, 'rbac.app.manage') },
          { path: 'admin/access/users/:userId', element: restricted(<AppUserAccessPage />, 'rbac.app.manage') },
          { path: 'admin/geo-mapping', element: restricted(<GeoMappingPage />, 'geo.manage') },
          { path: 'admin/system-settings', element: restricted(<AdminSystemSettingsPage />, 'admin.settings.manage') },
          { path: 'org/access/permissions', element: contextRestricted(<OrgPermissionsPage />, 'rbac.org.manage', ['organization']) },
          { path: 'org/access/roles', element: contextRestricted(<OrgRolesPage />, 'rbac.org.manage', ['organization']) },
          { path: 'org/access/staff/:userId', element: contextRestricted(<OrgStaffAccessPage />, 'rbac.org.manage', ['organization']) },
          { path: 'settings', element: restricted(<SettingsPage />, 'auth.me.read') },
          { path: 'settings/my-profile', element: restricted(<MyProfileSettingsPage />, 'auth.me.read') },
          { path: 'settings/appearance', element: contextRestricted(<AppearanceSettingsPage />, 'auth.me.read', ['platform']) },
          { path: 'settings/brand', element: contextRestricted(<BrandSettingsPage />, brandAdminPermissions, ['organization']) },
          { path: 'settings/accessibility', element: contextRestricted(<AccessibilitySettingsPage />, 'auth.me.read', ['platform', 'organization']) },
          { path: 'settings/users', element: contextRestricted(<UserSettingsPage />, 'profile.user.update', ['platform', 'organization'], ['organization']) },
          { path: 'settings/global-services', element: contextRestricted(<GlobalServicesPage />, ['global.services.manage', 'global.services.create', 'global.services.update', 'global.services.delete'], ['platform', 'organization']) },
          { path: 'unauthorized', element: withSuspense(<UnauthorizedPage />) },
        ],
      },
    ],
  },
  { path: '/unauthorized', element: <Navigate to="/app/unauthorized" replace /> },
  { path: '*', element: withSuspense(<NotFoundPage />) },
]);
