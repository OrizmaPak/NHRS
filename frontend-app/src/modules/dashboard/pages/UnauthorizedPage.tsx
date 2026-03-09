import { ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

type UnauthorizedPageProps = {
  deniedPermission?: string | string[];
};

function formatDeniedPermission(value?: string | string[]): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const keys = value.map((entry) => String(entry).trim()).filter(Boolean);
    if (keys.length === 0) return null;
    return keys.length === 1 ? keys[0] : `Any of: ${keys.join(', ')}`;
  }
  const key = String(value).trim();
  return key.length > 0 ? key : null;
}

export function UnauthorizedPage({ deniedPermission }: UnauthorizedPageProps) {
  const denied = formatDeniedPermission(deniedPermission);

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
        {denied ? (
          <p className="mt-4 text-xs text-muted">
            Denied permission: <span className="font-mono text-foreground">{denied}</span>
          </p>
        ) : null}
        <p className="mt-4 text-xs text-muted">Try switching context from the top bar or contact an administrator for permission access.</p>
      </div>
    </div>
  );
}
