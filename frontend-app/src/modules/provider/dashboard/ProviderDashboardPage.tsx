import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiGrid } from '@/components/data/KpiGrid';
import { StatCard } from '@/components/data/StatCard';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PermissionGate } from '@/components/navigation/PermissionGate';
import { usePatientSearch } from '@/api/hooks/usePatientSearch';
import { useEmergencyInventory, useEmergencyRequestsSummary } from '@/api/hooks/useEmergencyInventory';
import { LoadingSkeleton } from '@/components/feedback/LoadingSkeleton';

export function ProviderDashboardPage() {
  const patientsQuery = usePatientSearch({ page: 1, limit: 1 });
  const inventoryQuery = useEmergencyInventory({ page: 1, limit: 1 });
  const emergencySummaryQuery = useEmergencyRequestsSummary();

  const isLoading = patientsQuery.isLoading || inventoryQuery.isLoading || emergencySummaryQuery.isLoading;
  const patientsSeenToday = patientsQuery.data?.total ?? 0;
  const pendingLabResults = emergencySummaryQuery.data?.pendingLabResults ?? 0;
  const pendingPharmacyOrders = emergencySummaryQuery.data?.pendingPharmacyOrders ?? 0;
  const emergencyAlerts = emergencySummaryQuery.data?.openRequests ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Dashboard"
        description="Operational overview for patient care, labs, pharmacy, and emergency attention."
        breadcrumbs={[{ label: 'Provider' }, { label: 'Dashboard' }]}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <LoadingSkeleton className="h-28 w-full" />
          <LoadingSkeleton className="h-28 w-full" />
          <LoadingSkeleton className="h-28 w-full" />
          <LoadingSkeleton className="h-28 w-full" />
        </div>
      ) : (
        <KpiGrid>
          <StatCard label="Patients Seen Today" value={String(patientsSeenToday)} delta="Live from profile search" trend="up" />
          <StatCard label="Pending Lab Results" value={String(pendingLabResults)} delta="Open emergency lab requests" trend={pendingLabResults > 0 ? 'up' : 'down'} />
          <StatCard label="Pending Pharmacy Orders" value={String(pendingPharmacyOrders)} delta="Open pharmacy resource requests" trend={pendingPharmacyOrders > 0 ? 'up' : 'down'} />
          <StatCard label="Emergency Alerts" value={String(emergencyAlerts)} delta={`${inventoryQuery.data?.total ?? 0} tracked inventory items`} trend={emergencyAlerts > 0 ? 'up' : 'down'} />
        </KpiGrid>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common workflow shortcuts for provider teams.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/app/provider/patients">Search patient</Link>
            </Button>
            <PermissionGate permission="encounters.create">
              <Button asChild variant="outline">
                <Link to="/app/provider/encounters/new">Add record</Link>
              </Button>
            </PermissionGate>
            <PermissionGate permission="labs.create">
              <Button asChild variant="outline">
                <Link to="/app/provider/labs/new">Open lab entry</Link>
              </Button>
            </PermissionGate>
            <PermissionGate permission="pharmacy.create">
              <Button asChild variant="outline">
                <Link to="/app/provider/pharmacy/new">Open pharmacy entry</Link>
              </Button>
            </PermissionGate>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
