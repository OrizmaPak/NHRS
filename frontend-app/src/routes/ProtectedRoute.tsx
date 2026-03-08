import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/feedback/Spinner';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionsStore } from '@/stores/permissionsStore';

type ProtectedRouteProps = {
  requiredPermission?: string;
  allowPasswordSetup?: boolean;
};

export function ProtectedRoute({ requiredPermission, allowPasswordSetup = false }: ProtectedRouteProps) {
  const location = useLocation();
  const initialized = useAuthStore((state) => state.initialized);
  const loading = useAuthStore((state) => state.loading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const _permissionsVersion = usePermissionsStore((state) => state.version);
  void _permissionsVersion;

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

  if (user?.requiresPasswordChange && !allowPasswordSetup) {
    return <Navigate to="/auth/password/setup" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/app/unauthorized" replace />;
  }

  return <Outlet />;
}
