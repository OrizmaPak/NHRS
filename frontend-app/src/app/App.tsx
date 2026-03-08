import { RouterProvider } from 'react-router-dom';
import { appRouter } from '@/routes/router';
import { Spinner } from '@/components/feedback/Spinner';
import { AppErrorBoundary } from '@/components/feedback/AppErrorBoundary';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { usePermissionContextSync } from '@/hooks/usePermissionContextSync';

export function App() {
  const { initialized, identityLoading } = useAppBootstrap();
  usePermissionContextSync();

  if (!initialized || identityLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted">
          <Spinner className="h-6 w-6" />
          <span className="text-sm">Initializing secure session...</span>
        </div>
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <RouterProvider router={appRouter} />
    </AppErrorBoundary>
  );
}
