import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-4">
      <div className="text-center">
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page you requested does not exist in this context.</p>
        <Button asChild className="mt-5">
          <Link to="/app">Return to workspace</Link>
        </Button>
      </div>
    </div>
  );
}
