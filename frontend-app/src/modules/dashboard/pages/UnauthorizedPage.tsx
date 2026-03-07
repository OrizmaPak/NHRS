import { ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function UnauthorizedPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div className="max-w-md text-center">
        <ShieldX className="mx-auto mb-3 h-10 w-10 text-danger" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Access denied</h1>
        <p className="mt-2 text-sm text-muted">You do not currently have permission to access this module in the active context.</p>
        <Button asChild className="mt-5">
          <Link to="/app">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
