import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/feedback/Spinner';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionsStore } from '@/stores/permissionsStore';

type ProtectedRouteProps = {
  requiredPermission?: string;
};

export function ProtectedRoute({ requiredPermission }: ProtectedRouteProps) {
  const location = useLocation();
  const initialized = useAuthStore((state) => state.initialized);
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasPermission = usePermissionsStore((state) => state.hasPermission);

  if (!initialized || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted">
          <Spinner className="h-6 w-6" />
          <span className="text-sm">Verifying session...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace state={{ from: location }} />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
