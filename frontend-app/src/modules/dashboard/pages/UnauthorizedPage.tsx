import { ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function UnauthorizedPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div className="max-w-lg text-center">
        <ShieldX className="mx-auto mb-3 h-10 w-10 text-danger" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Access denied in this context</h1>
        <p className="mt-2 text-sm text-muted">
          You are signed in, but your current role or active context does not grant access to this module.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link to="/app">Back to dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/settings">Open settings</Link>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted">Try switching context from the top bar or contact an administrator for permission access.</p>
      </div>
    </div>
  );
}
